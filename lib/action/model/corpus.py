# Copyright(c) 2013 Charles University, Faculty of Arts,
#                   Institute of the Czech National Corpus
# Copyright(c) 2013 Tomas Machalek <tomas.machalek@gmail.com>
# Copyright(c) 2022 Martin Zimandl <martin.zimandl@gmail.com>
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; version 2
# dated June, 1991.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.


import urllib.parse
from dataclasses import asdict
from functools import partial
from typing import (Any, Callable, Dict, Iterable, List, Optional, Tuple,
                    TypeVar, Union)

import corplib
import l10n
import plugins
import settings
from action.argmapping import Args, ConcArgsMapping
from action.argmapping.conc.query import ConcFormArgs
from action.errors import (AlignedCorpusForbiddenException, ForbiddenException,
                           ImmediateRedirectException, NotFoundException,
                           UserActionException)
from action.krequest import KRequest
from action.model.user import UserActionModel, UserPluginCtx
from action.plugin.ctx import AbstractCorpusPluginCtx
from action.props import ActionProps
from action.req_args import JSONRequestArgsProxy, RequestArgsProxy
from action.response import KResponse
from corplib.abstract import AbstractKCorpus
from corplib.corpus import KCorpus
from corplib.fallback import EmptyCorpus, ErrorCorpus
from main_menu.model import EventTriggeringItem, MainMenu
from plugin_types.corparch.corpus import BrokenCorpusInfo, CorpusInfo
from texttypes.model import TextTypes, TextTypesCache
from util import as_sync

T = TypeVar('T')


class CorpusActionModel(UserActionModel):
    """
    CorpusActionModel extends UserActionModel by corpus-related functionality.
    It always tries to instantiate a corpus based on actual URL (form) arguments
    or via some logic for inferring a default corpus.
    """
    # main menu items disabled for public users (this is applied automatically during
    # post_dispatch())
    ANON_FORBIDDEN_MENU_ITEMS = (
        MainMenu.NEW_QUERY('history', 'wordlist'),
        MainMenu.CORPORA('my-subcorpora', 'create-subcorpus'),
        MainMenu.SAVE, MainMenu.CONCORDANCE, MainMenu.FILTER,
        MainMenu.FREQUENCY, MainMenu.COLLOCATIONS)

    LOCAL_COLL_OPTIONS = ('cattr', 'cfromw', 'ctow', 'cminfreq', 'cminbgr', 'cbgrfns', 'csortfn')

    BASE_ATTR: str = 'word'  # TODO this value is actually hardcoded throughout the code

    def __init__(self, req: KRequest, resp: KResponse, action_props: ActionProps, tt_cache: TextTypesCache):
        super().__init__(req, resp, action_props, tt_cache)
        self._proc_time: Optional[float] = None
        self.args: Args = Args()

        # Note: always use _corp() method to access current corpus even from inside the class
        self._curr_corpus: Optional[KCorpus] = None
        self._corpus_variant: str = ''  # a prefix for a registry file

        # query_persistence plugin related attributes
        self._q_code: Optional[str] = None  # a key to 'code->query' database

        # data of the currently active operation are stored here
        self._active_q_data: Optional[Dict[str, Any]] = None

        self._auto_generated_conc_ops: List[Tuple[int, ConcFormArgs]] = []

        self._on_query_store: List[Callable[[List[str], Optional[int], Dict[str, Any]], None]] = [
            lambda s, uh, res: None]

        self._tt_cache = tt_cache

        self._tt = None  # this will be instantiated lazily

        self._plugin_ctx: Optional[CorpusPluginCtx] = None

    @property
    def plugin_ctx(self):
        if self._plugin_ctx is None:
            self._plugin_ctx = CorpusPluginCtx(self, self._req, self._resp)
        return self._plugin_ctx

    @property
    def corpus_variant(self):
        return self._corpus_variant

    @property
    def q_code(self):
        return self._q_code

    @property
    def active_q_data(self):
        return self._active_q_data

    def on_query_store(self, fn: Callable[[List[str], Optional[int], Any], None]):
        """
        Register a function called after a query (conc, pquery, wordlist) has been stored.
        The function arguments are:
        1) list of query IDs involved in the operation
        2) timestamp of the save operation
        3) result Dict passed to a respective output page
        """
        self._on_query_store.append(fn)

    # TODO move to a more specific req_context object
    async def get_corpus_info(self, corp: str) -> CorpusInfo:
        with plugins.runtime.CORPARCH as plg:
            return await plg.get_corpus_info(self.plugin_ctx, corp)

    def get_current_aligned_corpora(self) -> List[str]:
        """
        Return currently active corpora

        note: the name is a bit confusing considering how 'align(ed)' is used elsewhere
        here we mean: all the aligned corpora including the primary one
        """
        return [self.args.corpname] + self.args.align

    def get_available_aligned_corpora(self) -> List[str]:
        """
        note: the name is a bit confusing considering how 'align(ed)' is used elsewhere
        here we mean: all the aligned corpora including the primary one
        """
        return [self.args.corpname] + [c for c in self.corp.get_conf('ALIGNED').split(',') if len(c) > 0]

    async def _load_corpus_settings(self, corpus_id):
        """
        """
        if self._user_has_persistent_settings():
            with plugins.runtime.SETTINGS_STORAGE as settings_plg:
                data = await settings_plg.load(self.session_get('user', 'id'), corpus_id)
        else:
            data = self.session_get('corpus_settings')
        if not data:
            data = {}
        return data

    async def _restore_prev_query_params(self, req_args: Union[RequestArgsProxy, JSONRequestArgsProxy]) -> bool:
        """
        Restores previously stored concordance/pquery/wordlist query data using an ID found in request arg 'q'.
        To even begin the search, two conditions must be met:
        1. query_persistence plugin is installed
        2. request arg 'q' contains a string recognized as a valid ID of a stored concordance query
           at the position 0 (other positions may contain additional regular query operations
           (shuffle, filter,...)

        Restored values will be stored in 'form' instance as forced ones preventing 'form'
        from returning its original values (no matter what is there).

        In case the query_persistence is installed and invalid ID is encountered
        UserActionException will be raised.

        Returns:
            True if query params have been loaded else False (which is still not an error)
        """
        url_q = req_args.getlist('q')[:]
        with plugins.runtime.QUERY_PERSISTENCE as query_persistence:
            if len(url_q) > 0 and query_persistence.is_valid_id(url_q[0]):
                self._q_code = url_q[0][1:]
                self._active_q_data = await query_persistence.open(self._q_code)
                # !!! must create a copy here otherwise _q_data (as prev query)
                # will be rewritten by self.args.q !!!
                if self._active_q_data is not None:
                    req_args.add_forced_arg('q', *(self._active_q_data.get('q', [])[:] + url_q[1:]))
                    corpora = self._active_q_data.get('corpora', [])
                    if len(corpora) > 0:
                        orig_corpora = req_args.add_forced_arg('corpname', corpora[0])
                        if len(orig_corpora) > 0 and orig_corpora[0] != corpora[0]:
                            raise UserActionException(self._req.translate(
                                f'URL argument corpname={orig_corpora[0]} collides with corpus '
                                f'{corpora[0]} stored as part of original concordance'))
                    if len(corpora) > 1:
                        req_args.add_forced_arg('align', *corpora[1:])
                        req_args.add_forced_arg('viewmode', 'align')
                    if self._active_q_data.get('usesubcorp', None):
                        req_args.add_forced_arg('usesubcorp', self._active_q_data['usesubcorp'])
                    return True
                else:
                    raise UserActionException(self._req.translate('Invalid or expired query'))
        return False

    async def _save_query_to_history(self, query_id: str, conc_data) -> Optional[int]:
        if conc_data.get('lastop_form', {}).get('form_type') in ('query', 'filter') and not self.user_is_anonymous():
            with plugins.runtime.QUERY_HISTORY as qh:
                ts = await qh.store(
                    user_id=self.session_get('user', 'id'),
                    query_id=query_id, q_supertype='conc')
                return ts
        return None

    def clear_prev_conc_params(self):
        self._active_q_data = None

    def get_curr_conc_args(self):
        args = self.get_mapped_attrs(ConcArgsMapping)
        if self._q_code:
            args['q'] = f'~{self._q_code}'
        else:
            args['q'] = [q for q in self.args.q]
        return args

    async def _check_corpus_access(self, req_args: Union[RequestArgsProxy, JSONRequestArgsProxy], action_props: ActionProps) -> Tuple[Union[str, None], str]:
        """
        Returns: a 2-tuple (corpus id, corpus variant)
        """
        with plugins.runtime.AUTH as auth:
            is_api = action_props.return_type == 'json' or req_args.getvalue(
                'format') == 'json'
            corpname, redirect = await self._determine_curr_corpus(req_args, is_api)
            has_access, variant = await auth.validate_access(corpname, self.session_get('user'))
            if has_access and redirect:
                url_pref = action_props.action_prefix + '/' if action_props.action_prefix else ''
                if len(url_pref) > 0:
                    url_pref = url_pref[1:]
                raise ImmediateRedirectException(self._req.create_url(
                    url_pref + action_props.action_name, dict(corpname=corpname)))
            elif not has_access:
                auth.on_forbidden_corpus(self.plugin_ctx, corpname, variant)
            for al_corp in req_args.getlist('align'):
                al_access, al_variant = await auth.validate_access(al_corp, self.session_get('user'))
                # we cannot accept aligned corpora without access right
                # or with different variant (from implementation reasons in this case)
                # than the main corpus has
                if not al_access or al_variant != variant:
                    raise AlignedCorpusForbiddenException(al_corp, al_variant)
            return corpname, variant

    async def pre_dispatch(self, req_args):
        """
        Runs before main action is processed. The action includes
        mapping of URL/form parameters to self.args, loading user
        options, validating corpus access rights, scheduled actions.

        It is OK to override this method but the super().pre_dispatch()
        should be always called before performing custom actions.
        It is also OK to raise UserActionException types if necessary.
        """
        req_args = await super().pre_dispatch(req_args)
        try:
            await self._restore_prev_query_params(req_args)
            # corpus access check and modify path in case user cannot access currently requested corp.
            corpname, self._corpus_variant = await self._check_corpus_access(req_args, self._action_props)
            # now we can apply also corpus-dependent settings
            # because the corpus name is already known
            if corpname is None:
                # make sure no unwanted corpname arg is used
                req_args.set_forced_arg('corpname', '')
            else:
                corpus_options = {}
                corpus_options.update((await self.get_corpus_info(corpname)).default_view_opts)
                corpus_options.update(await self._load_corpus_settings(corpname))
                self.args.map_args_to_attrs(corpus_options)
                req_args.set_forced_arg('corpname', corpname)
            # always prefer corpname returned by _check_corpus_access()
            # TODO we should reflect align here if corpus has changed

            # now we apply args from URL (highest priority)
            self.args.map_args_to_attrs(req_args)
            # validate self.args.maincorp which is dependent on 'corpname', 'align'
            if self.args.maincorp and (self.args.maincorp != self.args.corpname and
                                       self.args.maincorp not in self.args.align):
                raise UserActionException(
                    f'Invalid argument value {self.args.maincorp} for "maincorp"',
                    code=422)

        except ValueError as ex:
            raise UserActionException(ex)

        # return url (for 3rd party pages etc.)
        args = {}
        if getattr(self.args, 'corpname'):
            args['corpname'] = getattr(self.args, 'corpname')
        if self._req.method == 'GET':
            self.return_url = self._req.updated_current_url(args)
        else:
            self.return_url = '{}query?{}'.format(self._req.get_root_url(),
                                                  '&'.join([f'{k}={v}' for k, v in list(args.items())]))

        self._curr_corpus = await self._load_corpus()

        # plugins setup
        for p in plugins.runtime:
            if callable(getattr(p.instance, 'setup', None)):
                p.instance.setup(self)

        if isinstance(self.corp, ErrorCorpus):
            raise self.corp.get_error()
        info = await self.get_corpus_info(self.args.corpname)
        if isinstance(info, BrokenCorpusInfo):
            raise NotFoundException(
                self._req.translate('Corpus \"{0}\" not available'.format(info.name)),
                internal_message=f'Failed to fetch configuration for {info.name}')

        return req_args

    async def resolve_error_state(self, req, resp, result, err):
        await super().resolve_error_state(req, resp, result, err)
        if self._curr_corpus is None:
            self._curr_corpus = ErrorCorpus(err)

    def add_save_menu_item(self, label: str, save_format: Optional[str] = None, hint: Optional[str] = None):
        if save_format is None:
            event_name = 'MAIN_MENU_SHOW_SAVE_FORM'
            self._dynamic_menu_items.append(
                EventTriggeringItem(MainMenu.SAVE, label, event_name, key_code=83, key_mod='shift',
                                    hint=hint).mark_indirect())  # key = 's'

        else:
            event_name = 'MAIN_MENU_DIRECT_SAVE'
            self._dynamic_menu_items.append(EventTriggeringItem(
                MainMenu.SAVE, label, event_name, hint=hint).add_args(('saveformat', save_format)))

    async def _determine_curr_corpus(self, form: RequestArgsProxy, is_api: bool):
        """
        This method tries to determine which corpus is currently in use.
        If no answer is found or in case there is a conflict between selected
        corpus and user access rights then some fallback alternative is found -
        in such case the returned 'fallback' value is set to a URL leading to the
        fallback corpus.

        Parameters:
        form -- currently processed HTML form (if any)

        Return:
        2-tuple with (current corpus, whether we should reload to the main page)
        """
        cn = ''
        redirect = False
        if is_api and len(form.corpora) == 0:
            raise UserActionException('No corpus specified')
        if len(form.corpora) > 0:
            cn = form.corpora[0]
        elif not self.user_is_anonymous():
            with plugins.runtime.QUERY_HISTORY as qh:
                queries = await qh.get_user_queries(self.session_get(
                    'user', 'id'), self.cm, limit=1, translate=self._req.translate)
                if len(queries) > 0:
                    cn = queries[0].get('corpname', '')
                    redirect = True

        # fallback option: if no current corpus is set then we try previous user's corpus
        # and if no such exists then we try default one as configured in settings.xml
        async def test_fn(auth_plg, cname):
            return await auth_plg.validate_access(cname, self.session_get('user'))

        if not cn:
            with plugins.runtime.AUTH as auth:
                cn = await settings.get_default_corpus(partial(test_fn, auth))
                redirect = True
        return cn, redirect

    async def _load_corpus(self):
        if self.args.corpname:
            try:
                corp = await self.cm.get_corpus(
                    self.args.corpname, subcname=self.args.usesubcorp,
                    corp_variant=self._corpus_variant, translate=self._req.translate)
                corp._conc_dir = self._conc_dir
                return corp
            except Exception as ex:
                return ErrorCorpus(ex)
        else:
            return EmptyCorpus()

    @property
    def corp(self) -> AbstractKCorpus:
        """
        Contains the current corpus. The property always contains a corpus-like object
        (even in case of an error). Possible values:

        1. a KCorpus (or KSubcorpus) instance in case everything is OK (corpus is known, object is initialized
        without errors)
        2. an ErrorCorpus instance in case an exception occurred
        3. an Empty corpus instance in case the action does not need one (but KonText's internals do).

        This should be always preferred over accessing _curr_corpus attribute.

        """
        return self._curr_corpus

    @property
    def tt(self) -> TextTypes:
        """
        Provides access to text types of the current corpus
        """
        return self._tt if self._tt is not None else TextTypes(
            self.corp, self.corp.corpname, self._tt_cache, self.plugin_ctx)

    async def _add_corpus_related_globals(self, result, maincorp):
        """
        arguments:
        result -- template data dict
        maincorp -- currently focused corpus; please note that in case of aligned
                    corpora this can be a different one than self.corp
                    (or self.args.corpname) represents.
        """
        result['corpname'] = getattr(self.args, 'corpname')
        result['align'] = getattr(self.args, 'align')
        result['human_corpname'] = self.corp.human_readable_corpname

        result['corp_description'] = maincorp.get_info()
        result['corp_size'] = self.corp.size

        if self.corp.is_subcorpus:
            self.args.usesubcorp = self.corp.subcname

        result['corpus_ident'] = dict(
            id=getattr(self.args, 'corpname'),
            variant=self._corpus_variant,
            name=self.corp.human_readable_corpname,
            usesubcorp=self.args.usesubcorp,
            origSubcorpName=self.corp.orig_subcname,
            foreignSubcorp=self.corp.author_id is not None and self.session_get(
                'user', 'id') != self.corp.author_id,
            size=self.corp.size,
            searchSize=self.corp.search_size)
        result['doc_structure'] = maincorp.get_conf('DOCSTRUCTURE')
        if self.corp.is_subcorpus:
            result['subcorp_size'] = self.corp.search_size
        else:
            result['subcorp_size'] = None
        sref = maincorp.get_conf('SHORTREF')
        result['fcrit_shortref'] = '+'.join([a.strip('=') + ' 0'
                                             for a in sref.split(',')])
        result['default_attr'] = maincorp.get_conf('DEFAULTATTR')
        if 'AttrList' not in result:
            result['AttrList'] = [{
                'label': maincorp.get_conf(f'{n}.LABEL') or n,
                'n': n,
                'multisep': maincorp.get_conf(f'{n}.MULTISEP'),
            } for n in maincorp.get_conf('ATTRLIST').split(',') if n]

        align_common_posattrs = set(self.corp.get_posattrs())
        for a in self.args.align:
            align_corp = await self.cm.get_corpus(a, translate=self._req.translate)
            align_common_posattrs.intersection_update(align_corp.get_posattrs())
        result['AlignCommonPosAttrs'] = list(align_common_posattrs)

        if maincorp.get_conf('FREQTTATTRS'):
            ttcrit_attrs = maincorp.get_conf('FREQTTATTRS')
        else:
            ttcrit_attrs = maincorp.get_conf('SUBCORPATTRS')
        result['ttcrit'] = [f'{a} 0' for a in ttcrit_attrs.replace('|', ',').split(',') if a]
        result['interval_chars'] = (
            settings.get('corpora', 'left_interval_char', None),
            settings.get('corpora', 'interval_char', None),
            settings.get('corpora', 'right_interval_char', None),
        )
        result['righttoleft'] = True if self.corp.get_conf('RIGHTTOLEFT') else False
        corp_info = await self.get_corpus_info(getattr(self.args, 'corpname'))
        result['bib_conf'] = corp_info.metadata
        result['simple_query_default_attrs'] = corp_info.simple_query_default_attrs

        poslist = []
        for tagset in corp_info.tagsets:
            if tagset.ident == corp_info.default_tagset:
                poslist = tagset.pos_category
                break
        result['Wposlist'] = [{'n': x.pos, 'v': x.pattern} for x in poslist]

    def get_mapped_attrs(self, attr_names: Iterable[str], force_values: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Returns required attributes (= passed attr_names) and their respective values found
        in 'self.args'. Only attributes initiated via class attributes and the Parameter class
        are considered valid.
        """
        if force_values is None:
            force_values = {}

        def is_valid(name, value):
            return hasattr(self.args, name) and value != ''

        def get_val(k):
            fld = Args.get_field(k)
            to_js = fld.metadata.get('to_js')
            return to_js(force_values[k]) if k in force_values else to_js(getattr(self.args, k, None))

        ans = {}
        for attr in attr_names:
            v_tmp = get_val(attr)
            if not is_valid(attr, v_tmp):
                continue
            if type(v_tmp) in (str, float, int, bool) or v_tmp is None:
                ans[attr] = v_tmp
            else:
                ans[attr] = [v for v in v_tmp]
        return ans

    async def export_optional_plugins_conf(self, result):
        await self._export_optional_plugins_conf(result, [self.args.corpname] + self.args.align)

    async def attach_plugin_exports(self, result, direct):
        await self._attach_plugin_exports(result, [self.args.corpname] + self.args.align, direct)

    async def add_globals(self, app, action_props, result):
        """
        Fills-in the 'result' parameter (dict or compatible type expected) with parameters need to render
        HTML templates properly.
        It is called after an action is processed but before any output starts.
        Please note that self.args mapping is not exported here even though some of the values
        from self.args are used here in specific ways.
        """
        result = await super().add_globals(app, action_props, result)
        result['multilevel_freq_dist_max_levels'] = settings.get(
            'corpora', 'multilevel_freq_dist_max_levels', 3)
        result['last_freq_level'] = self.session_get('last_freq_level')  # TODO enable this
        if result['last_freq_level'] is None:
            result['last_freq_level'] = 1

        if self.args.maincorp and self.args.maincorp != self.args.corpname:
            try:
                thecorp = await self.cm.get_corpus(self.args.maincorp, translate=self._req.translate)
            except Exception as ex:
                thecorp = ErrorCorpus(ex)
        else:
            thecorp = self.corp

        await self._add_corpus_related_globals(result, thecorp)
        result['uses_corp_instance'] = True

        result['undo_q'] = urllib.parse.urlencode([('q', q) for q in getattr(self.args, 'q')[:-1]])
        result['shuffle_min_result_warning'] = settings.get_int(
            'global', 'shuffle_min_result_warning', 100000)

        result['has_subcmixer'] = plugins.runtime.SUBCMIXER.exists
        result['use_conc_toolbar'] = settings.get_bool('global', 'use_conc_toolbar')
        with plugins.runtime.QUERY_PERSISTENCE as qp:
            result['conc_url_ttl_days'] = qp.get_conc_ttl_days(self.session_get('user', 'id'))

        result['explicit_conc_persistence_ui'] = settings.get_bool(
            'global', 'explicit_conc_persistence_ui', False)

        for k in asdict(self.args):
            if k not in result:
                result[k] = getattr(self.args, k)

        return result

    def get_struct_opts(self) -> str:
        """
        Returns structures and structural attributes the current concordance should display.
        Note: current solution is little bit confusing - there are two overlapping parameters
        here: structs & structattrs where the former is the one used in URL and the latter
        stores user's persistent settings (but can be also passed via URL with some limitations).
        """
        return ','.join(x for x in (self.args.structs, ','.join(self.args.structattrs)) if x)

    async def get_tt_bib_mapping(self, tt_data):
        bib_mapping = {}
        with plugins.runtime.LIVE_ATTRIBUTES as la:
            if await la.is_enabled_for(self.plugin_ctx, [self.args.corpname] + self.args.align):
                with plugins.runtime.CORPARCH as ca:
                    corpus_info = await ca.get_corpus_info(self.plugin_ctx, self.args.corpname)
                id_attr = corpus_info.metadata.id_attr
                if id_attr in tt_data:
                    bib_mapping = dict(await la.find_bib_titles(
                        self.plugin_ctx, getattr(self.args, 'corpname'), tt_data[id_attr]
                    ))
        return bib_mapping

    def export_subcorpora_list(self, corpname: str, curr_subcorp: str, out: Dict[str, Any]):
        """
        Updates passed dictionary by information about available sub-corpora.
        Listed values depend on current user and corpus.
        If there is a list already present in 'out' then it is extended
        by the new values.

        The function also adds a current subcorpus in case it is a published
        foreign (= of a different user) subcorpus.

        arguments:
        corpname -- corpus id
        curr_subcorp -- current subcorpus (even a public foreign one)
        out -- a dictionary used by templating system
        """
        subcorp_list = l10n.sort(
            self.user_subc_names(corpname), loc=self._req.ui_lang, key=lambda x: x['n'])

        if self.corp and self.corp.is_published and self.corp.subcname == curr_subcorp:
            try:
                srch = next((x for x in subcorp_list if x['pub'] == self.corp.subcname))
            except StopIteration:
                srch = None
            if srch is None:
                subcorp_list.insert(0, dict(v=self.corp.orig_subcname, n=self.corp.orig_subcname,
                                            pub=self.corp.subcname, foreign=True))
        if len(subcorp_list) > 0:
            subcorp_list = [
                {'n': '--{}--'.format(self._req.translate('whole corpus')), 'v': ''}] + subcorp_list

        if out.get('SubcorpList', None) is None:
            out['SubcorpList'] = []
        out['SubcorpList'].extend(subcorp_list)

    def store_last_search(self, op_type: str, conc_id: str):
        """
        Store last search operation ID. This is used when
        a new form of the same search type is opened and
        we need some relevant defaults.

        possible types: pquery, conc, wlist
        """
        curr = self._req.ctx.session.get('last_search', {})
        curr[op_type] = conc_id
        self._req.ctx.session['last_search'] = curr

    async def attach_aligned_query_params(self, tpl_out: Dict[str, Any]) -> None:
        """
        Adds template data required to generate components for adding/overviewing
        aligned corpora. This is called by individual actions.

        arguments:
        tpl_out -- a dict where exported data is stored
        """
        if self.corp.get_conf('ALIGNED'):
            tpl_out['Aligned'] = []
            if 'input_languages' not in tpl_out:
                tpl_out['input_languages'] = {}
            for al in self.corp.get_conf('ALIGNED').split(','):
                alcorp = await self.cm.get_corpus(al, translate=self._req.translate)
                corp_info = await self.get_corpus_info(al)

                tpl_out['Aligned'].append(dict(label=alcorp.get_conf('NAME') or al, n=al))

                poslist = []
                for tagset in corp_info.tagsets:
                    if tagset.ident == corp_info.default_tagset:
                        poslist = tagset.pos_category
                        break
                tpl_out['Wposlist_' + al] = [{'n': x.pos, 'v': x.pattern} for x in poslist]
                tpl_out['input_languages'][al] = corp_info.collator_locale


class CorpusPluginCtx(UserPluginCtx, AbstractCorpusPluginCtx):

    def __init__(self, action_model: CorpusActionModel, request: KRequest, response: KResponse):
        super().__init__(action_model, request, response)
        self._action_model = action_model

    @property
    def current_corpus(self) -> AbstractKCorpus:
        return self._action_model.corp

    @property
    def aligned_corpora(self):
        return self._action_model.args.align

    @property
    def available_aligned_corpora(self):
        return self._action_model.get_available_aligned_corpora()

    @property
    def corpus_manager(self) -> corplib.CorpusManager:
        return self._action_model.cm
