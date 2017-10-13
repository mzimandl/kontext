#!/usr/bin/env python
# Copyright (c) 2014 Charles University in Prague, Faculty of Arts,
#                    Institute of the Czech National Corpus
# Copyright (c) 2014 Tomas Machalek <tomas.machalek@gmail.com>
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
"""
Interactive (ad hoc) subcorpus selection.

Required XML configuration:

element live_attributes {
  element module { "ucnk_live_attributes" }
  element js_module { "ucnkLiveAttributes" }
  element max_attr_visible_chars {
    attribute extension-by { "ucnk" }
    xsd:integer
  }
}
"""

import re
import json
from functools import wraps
from hashlib import md5
from functools import partial
from collections import defaultdict, OrderedDict, Iterable
import sqlite3

import l10n
from plugins import inject
import plugins
from plugins.abstract.live_attributes import AbstractLiveAttributes
from templating.filters import Shortener
from controller import exposed
from actions import concordance
import query


def create_cache_key(attr_map, max_attr_list_size, corpus, aligned_corpora, autocomplete_attr, limit_lists):
    """
    Generates a cache key based on the relevant parameters.
    Returned value is hashed.
    """
    return md5('%r %r %r %r %r %r' % (attr_map, max_attr_list_size, corpus, aligned_corpora,
                                      autocomplete_attr, limit_lists)).hexdigest()


def canonical_corpname(corpname):
    """
    Removes all additional information from corpus name (in UCNK case this means removing path-like prefixes)
    """
    return corpname.rsplit('/', 1)[-1]


def cached(f):
    """
    A decorator which tries to look for a key in cache before
    actual storage is invoked. If cache miss in encountered
    then the value is stored to the cache to be available next
    time.
    """
    @wraps(f)
    def wrapper(self, plugin_api, corpus, attr_map, aligned_corpora=None, autocomplete_attr=None, limit_lists=True):
        db = self.db(plugin_api, canonical_corpname(corpus.corpname))
        if len(attr_map) < 2:
            key = create_cache_key(attr_map, self.max_attr_list_size, corpus.corpname, aligned_corpora,
                                   autocomplete_attr, limit_lists)
            ans = self.from_cache(db, key)
            if ans:
                return ans
        ans = f(self, plugin_api, corpus, attr_map, aligned_corpora, autocomplete_attr, limit_lists)
        if len(attr_map) < 2:
            key = create_cache_key(attr_map, self.max_attr_list_size, corpus.corpname, aligned_corpora,
                                   autocomplete_attr, limit_lists)
            self.to_cache(db, key, ans)
        return self.export_num_strings(ans)
    return wrapper


@exposed(return_type='json', http_method='POST')
def filter_attributes(self, request):
    attrs = json.loads(request.form.get('attrs', '{}'))
    aligned = json.loads(request.form.get('aligned', '[]'))
    with plugins.runtime.LIVE_ATTRIBUTES as lattr:
        return lattr.get_attr_values(self._plugin_api, corpus=self.corp, attr_map=attrs,
                                     aligned_corpora=aligned)


@exposed(return_type='json', http_method='POST')
def attr_val_autocomplete(self, request):
    attrs = json.loads(request.form.get('attrs', '{}'))
    aligned = json.loads(request.form.get('aligned', '[]'))
    attrs[request.form['patternAttr']] = '%%%s%%' % request.form['pattern']
    with plugins.runtime.LIVE_ATTRIBUTES as lattr:
        return lattr.get_attr_values(self._plugin_api, corpus=self.corp, attr_map=attrs,
                                     aligned_corpora=aligned,
                                     autocomplete_attr=request.form['patternAttr'])


class LiveAttributes(AbstractLiveAttributes):

    def __init__(self, corparch, max_attr_list_size, empty_val_placeholder,
                 max_attr_visible_chars):
        self.corparch = corparch
        self.max_attr_list_size = max_attr_list_size
        self.empty_val_placeholder = empty_val_placeholder
        self.databases = {}
        self.shorten_value = partial(Shortener().filter, nice=True)
        self._max_attr_visible_chars = max_attr_visible_chars

    def export_actions(self):
        return {concordance.Actions: [filter_attributes, attr_val_autocomplete]}

    def db(self, user_lang, corpname):
        """
        Returns thread-local database connection to a sqlite3 database

        arguments:
        user_lang -- user language (e.g. en_US)
        corpname -- canonical corpus name
        """
        if corpname not in self.databases:
            db_path = self.corparch.get_corpus_info(user_lang, corpname).get('metadata', {}).get('database')
            if db_path:
                self.databases[corpname] = sqlite3.connect(db_path)
                self.databases[corpname].row_factory = sqlite3.Row
            else:
                self.databases[corpname] = None
        return self.databases[corpname]

    def is_enabled_for(self, plugin_api, corpname):
        """
        Returns True if live attributes are enabled for selected corpus else returns False
        """
        return self.db(plugin_api.user_lang, corpname) is not None

    def execute_sql(self, db, sql, args=()):
        cursor = db.cursor()
        cursor.execute(sql, args)
        return cursor

    def calc_max_attr_val_visible_chars(self, corpus_info):
        if corpus_info.metadata.avg_label_attr_len:
            return corpus_info.metadata.avg_label_attr_len
        else:
            return self._max_attr_visible_chars

    @staticmethod
    def export_num_strings(data):
        """
        Transform strings representing integer numbers to ints
        """
        if type(data) is dict:
            for k in data.keys():
                if type(data[k]) is str and data[k].isdigit():
                    data[k] = int(data[k])
        return data

    def from_cache(self, db, key):
        """
        Loads a value from cache. The key is whole attribute_map as selected
        by a user. But there is no guarantee that all the keys and values will be
        used as a key.

        arguments:
        key -- a cache key

        returns:
        a stored value matching provided argument or None if nothing is found
        """
        ans = self.execute_sql(db, "SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
        if ans:
            return LiveAttributes.export_num_strings(json.loads(str(ans[0])))
        return None

    def to_cache(self, db, key, values):
        """
        Stores a data object "values" into the cache. The key is whole attribute_map as selected
        by a user. But there is no guarantee that all the keys and values will be
        used as a key.

        arguments:
        key -- a cache key
        values -- a dictionary with arbitrary nesting level
        """
        value = json.dumps(values)
        self.execute_sql(db, 'BEGIN IMMEDIATE')
        self.execute_sql(db, "INSERT INTO cache (key, value) VALUES (?, ?)", (key, value))
        db.commit()

    @staticmethod
    def export_key(k):
        if k == 'corpus_id':
            return k
        return k.replace('_', '.', 1)

    @staticmethod
    def import_key(k):
        return k.replace('.', '_', 1) if k is not None else k

    @staticmethod
    def _get_subcorp_attrs(corpus):
        return [x.replace('.', '_', 1) for x in re.split(r'\s*[,|]\s*', corpus.get_conf('SUBCORPATTRS'))]

    @staticmethod
    def _group_bib_items(data, bib_label):
        """
        In bibliography column, items with the same title (column number 2)
        can be set to be grouped together (corpus/metadata/group_duplicates tag).

        Note.: please note that this cannot be done within the database
        as we have to treat data columns as independent which is not the
        case in the database (e.g. GROUP BY ... publish_date,... may
        produce multiple items with the same title - just from different
        years/months/...).
        """
        ans = OrderedDict()
        for item in data[bib_label]:
            label = item[2]
            if label not in ans:
                ans[label] = list(item)
            else:
                ans[label][3] += 1
                ans[label][4] += item[4]
            if ans[label][3] > 1:
                # use label with special prefix '@' as ID for grouped items
                # (to be able to distinguish between individual ID-identified and
                # grouped label-identified items)
                ans[label][1] = '@' + ans[label][2]
        data[bib_label] = ans.values()

    def get_sattr_pair_sizes(self, corpname, sattr1, sattr2, sattr_values):

        def convert_empty(s):
            return s if s != '' else None

        def mk_eq_expr(sattr, v, args):
            if v != '':
                args.append(v)
                return '{0} = ?'.format(sattr)
            else:
                return '{0} is NULL'.format(sattr)

        db = self.db('en_US', canonical_corpname(corpname))  # we don't care about info localization here
        where_sql = []
        where_args = []
        sattr1, sattr2 = sattr1.replace('.', '_'), sattr2.replace('.', '_')
        for pair in sattr_values:
            expr1 = mk_eq_expr(sattr1, pair[0], where_args)
            expr2 = mk_eq_expr(sattr2, pair[1], where_args)
            where_sql.append('{0} AND {1}'.format(expr1, expr2))
        cursor = self.execute_sql(db, 'SELECT {0}, {1}, SUM(poscount) FROM item WHERE {2} GROUP BY {0}, {1}'.format(
                                  sattr1, sattr2, ' OR '.join(where_sql)), where_args)
        mapping = {}
        for row in cursor.fetchall():
            if row[0] not in mapping:
                mapping[row[0]] = {}
            mapping[row[0]][row[1]] = row[2]
        ans = []
        for item in sattr_values:
            ans.append(mapping.get(convert_empty(item[0]), {}).get(convert_empty(item[1]), 0))
        return ans

    def get_supported_structures(self, corpname):
        corpus_info = self.corparch.get_corpus_info('en_US', corpname)
        id_attr = corpus_info.metadata.id_attr
        return [id_attr.split('.')[0]] if id_attr else []

    def get_subc_size(self, plugin_api, corpus, attr_map):
        db = self.db(plugin_api.user_lang, corpus.corpname)
        attr_where = [corpus.corpname]
        attr_where_tmpl = [u'corpus_id = ?']
        for k, vlist in attr_map.items():
            tmp = []
            for v in vlist:
                attr_where.append(v)
                tmp.append(u'%s = ?' % (self.import_key(k), ))  # TODO escape the 'k'
            attr_where_tmpl.append(u'({0})'.format(u' OR '.join(tmp)))
        cur = self.execute_sql(db, u'SELECT SUM(poscount) FROM item WHERE {0}'.format(u' AND '.join(attr_where_tmpl)),
                               attr_where)
        return cur.fetchone()[0]

    @cached
    def get_attr_values(self, plugin_api, corpus, attr_map, aligned_corpora=None, autocomplete_attr=None,
                        limit_lists=True):
        """
        Finds all the available values of remaining attributes according to the
        provided attr_map and aligned_corpora

        arguments:
        corpus -- manatee.corpus object
        attr_map -- a dictionary of attributes and values as selected by a user
        aligned_corpora -- a list/tuple of corpora names aligned to base one (the 'corpus' argument)
        autocomplete_attr -- such attribute will be also part of selection even if it is a part 'WHERE ...' condition

        returns:
        a dictionary containing matching attributes and values
        """
        corpname = canonical_corpname(corpus.corpname)
        corpus_info = self.corparch.get_corpus_info(plugin_api.user_lang, corpname)

        srch_attrs = set(self._get_subcorp_attrs(corpus))
        expand_attrs = set()  # attributes we want to be full lists even if their size exceeds configured max. value

        # add bibliography column if required
        bib_label = self.import_key(corpus_info.metadata.label_attr)
        if bib_label:
            srch_attrs.add(bib_label)
        # always include number of positions column
        srch_attrs.add('poscount')
        # if in autocomplete mode then always expand list of the target column
        if autocomplete_attr:
            a = self.import_key(autocomplete_attr)
            srch_attrs.add(a)
            expand_attrs.add(a)
        # also make sure that range attributes are expanded to full lists
        for k, v in attr_map.items():
            if query.is_range_argument(v):
                expand_attrs.add(self.import_key(k))

        query_builder = query.QueryBuilder(corpus_info=corpus_info,
                                           attr_map=attr_map,
                                           srch_attrs=srch_attrs,
                                           aligned_corpora=aligned_corpora,
                                           autocomplete_attr=self.import_key(autocomplete_attr),
                                           empty_val_placeholder=self.empty_val_placeholder)
        data_iterator = query.DataIterator(self.db(plugin_api.user_lang, corpname), query_builder)

        # initialize result dictionary
        ans = dict((attr, set()) for attr in srch_attrs)
        ans['poscount'] = 0

        # 1) values collected one by one are collected in tmp_ans and then moved to 'ans' with some exporting tweaks
        # 2) in case of values exceeding max. allowed list size we just accumulate their size directly to ans[attr]
        tmp_ans = defaultdict(lambda: defaultdict(lambda: 0))  # {attr_id: {attr_val: num_positions,...},...}
        shorten_val = partial(self.shorten_value, length=self.calc_max_attr_val_visible_chars(corpus_info))
        bib_id = self.import_key(corpus_info.metadata.id_attr)

        # here we iterate through [(row1, key1), (row1, key2),..., (row1, keyM), (row2, key1), (row2, key2),...]
        for row, col_key in data_iterator:
            if type(ans[col_key]) is set:
                val_ident = row[bib_id] if col_key == bib_label else row[col_key]
                attr_val = (shorten_val(unicode(row[col_key])), val_ident, row[col_key], 1)  # 1 = grouping
                tmp_ans[col_key][attr_val] += row['poscount']
            elif type(ans[col_key]) is int:
                ans[col_key] += int(row[col_key])  # we rely on proper 'ans' initialization here (in terms of types)
        # here we append position count information to the respective items
        for attr, v in tmp_ans.items():
            for k, c in v.items():
                ans[attr].add(k + (c,))
        # now each line contains: (shortened_label, identifier, label, num_grouped_items, num_positions)
        # where num_grouped_items is initialized to 1
        if corpus_info.group_duplicates:
            self._group_bib_items(ans, bib_label)
        tmp_ans.clear()
        return self._export_attr_values(data=ans, aligned_corpora=aligned_corpora,
                                        expand_attrs=expand_attrs,
                                        collator_locale=corpus_info.collator_locale,
                                        max_attr_list_size=self.max_attr_list_size if limit_lists else None)

    def _export_attr_values(self, data, aligned_corpora, expand_attrs, collator_locale, max_attr_list_size):
        values = {}
        exported = dict(attr_values=values, aligned=aligned_corpora)
        for k in data.keys():
            if isinstance(data[k], Iterable):
                if len(data[k]) <= max_attr_list_size or max_attr_list_size is None or k in expand_attrs:
                    out_data = l10n.sort(data[k], collator_locale, key=lambda t: t[0])
                    values[self.export_key(k)] = out_data
                else:
                    values[self.export_key(k)] = {'length': len(data[k])}
            else:
                values[self.export_key(k)] = data[k]
        exported['poscount'] = values['poscount']
        return exported

    def get_bibliography(self, plugin_api, corpus, item_id):
        db = self.db(plugin_api.user_lang, canonical_corpname(corpus.corpname))
        col_rows = self.execute_sql(db, 'PRAGMA table_info(\'bibliography\')').fetchall()

        corpus_info = self.corparch.get_corpus_info(plugin_api.user_lang, corpus.corpname)
        if corpus_info.metadata.sort_attrs:
            col_rows = sorted(col_rows, key=lambda v: v[1])   # here we accept default collator as attr IDs are ASCII
        col_map = OrderedDict([(x[1], x[0]) for x in col_rows])
        if 'corpus_id' in col_map:
            ans = self.execute_sql(db, 'SELECT * FROM bibliography WHERE id = ? AND corpus_id = ? LIMIT 1',
                                   (item_id, canonical_corpname(corpus.corpname))).fetchone()
        else:
            ans = self.execute_sql(db, 'SELECT * FROM bibliography WHERE id = ? LIMIT 1', (item_id,)).fetchone()
        return [(k, ans[i]) for k, i in col_map.items() if k != 'id']

    def find_bib_titles(self, plugin_api, corpus_id, id_list):
        with plugins.runtime.CORPARCH as ca:
            corpus_info = ca.get_corpus_info(plugin_api.user_lang, corpus_id)
        label_attr = self.import_key(corpus_info.metadata.label_attr)
        db = self.db(plugin_api.user_lang, corpus_id)
        pch = ', '.join(['?'] * len(id_list))
        ans = self.execute_sql(db, 'SELECT id, %s FROM bibliography WHERE id IN (%s)' % (label_attr, pch), id_list)
        return [(r[0], r[1]) for r in ans]


@inject(plugins.runtime.CORPARCH)
def create_instance(settings, corparch):
    """
    creates an instance of the plugin

    arguments:
    corparch -- corparch plugin
    """
    la_settings = settings.get('plugins', 'live_attributes')
    return LiveAttributes(corparch=corparch,
                          max_attr_list_size=settings.get_int('global', 'max_attr_list_size'),
                          empty_val_placeholder=settings.get('corpora', 'empty_attr_value_placeholder'),
                          max_attr_visible_chars=int(la_settings.get('ucnk:max_attr_visible_chars', 20)))
