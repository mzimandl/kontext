/*
 * Copyright (c) 2016 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2016 Tomas Machalek <tomas.machalek@gmail.com>
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; version 2
 * dated June, 1991.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.

 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

import { IFullActionControl } from 'kombo';
import { Observable, of as rxOf } from 'rxjs';
import { tap } from 'rxjs/operators';
import { tuple, pipe, Dict, List, HTTP, id } from 'cnc-tskit';

import * as Kontext from '../../types/kontext';
import { PageModel } from '../../app/page';
import { QueryContextModel } from './context';
import { validateNumber, setFormItemInvalid } from '../../models/base';
import { GeneralQueryFormProperties, QueryFormModel, QueryFormModelState,
    FilterServerArgs, determineSupportedWidgets, getTagBuilderSupport, FilterTypes, suggestionsEnabled } from './common';
import { Actions } from './actions';
import { Actions as ConcActions } from '../concordance/actions';
import { Actions as MainMenuActions } from '../mainMenu/actions';
import * as PluginInterfaces from '../../types/plugins';
import { TextTypesModel } from '../textTypes/main';
import { AjaxConcResponse } from '../concordance/common';
import { QueryType, AnyQuery, AdvancedQuery, SimpleQuery, parseSimpleQuery } from './query';
import { highlightSyntaxStatic } from './cqleditor/parser';
import { AttrHelper } from './cqleditor/attrs';
import * as formArgs from './formArgs';


/**
 * This interface encodes values of multiple filter values. Array indices
 * should match query pipeline with non-filter ones represented by
 * 'undefined'.
 */
export interface FilterFormProperties extends GeneralQueryFormProperties {
    filters:Array<string>;
    maincorps:{[sourceId:string]:string};
    currQueryTypes:{[sourceId:string]:QueryType};
    // current queries values (e.g. when restoring a form state)
    currQueries:{[sourceId:string]:string};
    currDefaultAttrValues:{[sourceId:string]:string};
    currUseRegexpValues:{[sourceId:string]:boolean};
    currLposValues:{[sourceId:string]:string};
    currQmcaseValues:{[sourceId:string]:boolean};
    currInclkwicValues:{[sourceId:string]:boolean};
    inputLanguage:string;
    currPnFilterValues:{[sourceId:string]:'p'|'n'};
    currFilflVlaues:{[sourceId:string]:'f'|'l'};
    currFilfposValues:{[sourceId:string]:string};
    currFiltposValues:{[sourceId:string]:string};
    withinArgValues:{[sourceId:string]:boolean};
    opLocks:{[sourceId:string]:boolean};
    hasLemma:{[sourceId:string]:boolean};
    tagsets:Array<PluginInterfaces.TagHelper.TagsetInfo>;
    isAnonymousUser:boolean;
    isLocalUiLang:boolean;
    simpleQueryDefaultAttrs:{[corpname:string]:Array<string|Array<string>>};
}

export function isFilterFormProperties(
    v:FilterFormProperties|formArgs.FilterFormArgs
):v is FilterFormProperties {

    return Array.isArray(v['filters']) && typeof v['maincorps'] === 'object';
}

/**
 * import {GeneralViewOptionsModel} from '../options/general';
 */
export function fetchFilterFormArgs<T extends
        formArgs.FilterFormArgs[keyof formArgs.FilterFormArgs]>(
    args:{[ident:string]:formArgs.ConcFormArgs},
    initialArgs:formArgs.FilterFormArgs,
    key:(item:formArgs.FilterFormArgs)=>T

):{[sourceId:string]:T} {
    return pipe(
        args,
        Dict.filter((v, _) => v.form_type === Kontext.ConcFormTypes.FILTER),
        Dict.map((args, _) => key(args as formArgs.FilterFormArgs)),
        (data) => ({...data, '__new__': key(initialArgs)})
    );
}


export interface FilterFormModelState extends QueryFormModelState {

    maincorps:{[key:string]:string};

    lposValues:{[key:string]:string};

    pnFilterValues:{[key:string]:FilterTypes};

    /**
     * Highlighted token FIRST/LAST. Specifies which token is highlighted.
     * This applies in case multiple matching tokens are found.
     */
    filflValues:{[key:string]:'f'|'l'};

    /**
     * Left range
     */
    filfposValues:{[key:string]:Kontext.FormValue<string>};

    /**
     * Right range
     */
    filtposValues:{[key:string]:Kontext.FormValue<string>};

    /**
     * Include kwic checkbox
     */
    inclkwicValues:{[key:string]:boolean};

    withinArgs:{[key:string]:boolean};

    hasLemma:{[key:string]:boolean};

    /**
     * If true for a certain key then the operation cannot be edited.
     * (this applies e.g. for filters generated by manual line
     * selection).
     */
    opLocks:{[key:string]:boolean};

    inputLanguage:string;

    tagsets:Array<PluginInterfaces.TagHelper.TagsetInfo>;

    changeMaincorp:string;
}

/**
 * Import form values either from a special properties object or from
 * an Ajax response used e.g. when replaying an operation.
 */
function importFormValues(src:FilterFormProperties):{[key:string]:AnyQuery};
function importFormValues(src:formArgs.FilterFormArgs, sourceId:string):{[key:string]:AnyQuery};
function importFormValues(src:any, sourceId?:string):{[key:string]:AnyQuery} {
    if (isFilterFormProperties(src)) {
        return pipe(
            sourceId ? [sourceId] : Dict.keys(src.currQueries),
            List.map<string, [string, AnyQuery]>(
                filter => {
                    if (src.currQueryTypes[filter] === 'advanced') {
                        const query = src.currQueries[filter] || '';
                        const [queryHtml,] = highlightSyntaxStatic({
                            query,
                            querySuperType: 'conc',
                            he: {translate: id}
                        });
                        return tuple<string, AdvancedQuery>(
                            filter,
                            {
                                corpname: filter,
                                qtype: 'advanced',
                                query,
                                queryHtml,
                                rawAnchorIdx: 0,
                                rawFocusIdx: 0,
                                parsedAttrs: [],
                                focusedAttr: undefined,
                                pcq_pos_neg: 'pos',
                                include_empty: false,
                                default_attr: src.currDefaultAttrValues[filter]
                            }
                        );

                    } else {
                        const query = src.currQueries[filter] || '';
                        return tuple<string, SimpleQuery>(
                            filter,
                                {
                                corpname: filter,
                                qtype: 'simple',
                                queryParsed: parseSimpleQuery(
                                    src.currQueries[filter] || '',
                                    src.currDefaultAttrValues[filter]
                                ),
                                query,
                                queryHtml: query,
                                rawAnchorIdx: 0,
                                rawFocusIdx: 0,
                                qmcase: src.currQmcaseValues[filter],
                                pcq_pos_neg: 'pos',
                                include_empty: false,
                                default_attr: src.currDefaultAttrValues[filter],
                                use_regexp: src.currUseRegexpValues[filter]
                            }
                        )
                    }
                }
            ),
            Dict.fromEntries()
        );

    } else if (sourceId && formArgs.isFilterFormArgs(src)) {
        const query = src.query || '';
        const [queryHtml,] = highlightSyntaxStatic({
            query,
            querySuperType: 'conc',
            he: {translate: id}
        });
        return {
            [sourceId]: src.query_type === 'advanced' ?
                {
                    corpname: sourceId,
                    qtype: 'advanced',
                    query,
                    queryHtml,
                    rawAnchorIdx: 0,
                    rawFocusIdx: 0,
                    parsedAttrs: [],
                    focusedAttr: undefined,
                    pcq_pos_neg: 'pos',
                    include_empty: false,
                    default_attr: src.default_attr
                } :
                {
                    corpname: sourceId,
                    qtype: 'simple',
                    queryParsed: parseSimpleQuery(
                        src.query,
                        src.default_attr
                    ),
                    query: src.query,
                    queryHtml: src.query,
                    rawAnchorIdx: 0,
                    rawFocusIdx: 0,
                    qmcase: src.qmcase,
                    pcq_pos_neg: 'pos',
                    include_empty: false,
                    default_attr: src.default_attr,
                    use_regexp: src.use_regexp
                }
        };

    } else {
        throw new Error('Failed to initialize filter form - invalid source object');
    }
}

function determineFilterTagWidgets(
    queries:{[sourceId:string]:AnyQuery},
    tagsets:Array<PluginInterfaces.TagHelper.TagsetInfo>,
    anonymousUser:boolean
):{[sourceId:string]:Array<string>} {

    return determineSupportedWidgets(
        queries,
        getTagBuilderSupport(pipe(
            queries,
            Dict.keys(),
            List.map(k => tuple(k, tagsets)),
            Dict.fromEntries()
        )),
        anonymousUser
    )
}

/**
 * Transform current filter type code based on whether we want to include
 * or exclude kwic.
 */
function pnfilterInclKwicConv(v:FilterTypes, inclKwic:boolean):FilterTypes {
    return ({
        'p+k': 'p',
        'P+k': 'p',
        'n+k': 'n',
        'N+k': 'n',
        'p-k': 'P',
        'P-k': 'P',
        'n-k': 'N',
        'N-k': 'N'
    } as {[key:string]:FilterTypes})[`${v}${inclKwic ? '+' : '-'}k`];
}

/**
 * FilterFormModel handles all the filtsters applied within a query "pipeline".
 * Each filter is identified by its database ID (i.e. a key used by conc_persistence
 * plug-in to store it). Please note that it does not know the order of filters
 * in pipeline (it is up to QueryReplay store to handle this).
 */
export class FilterFormModel extends QueryFormModel<FilterFormModelState> {

    private readonly syncInitialArgs:formArgs.FilterFormArgs;

    constructor(
            dispatcher:IFullActionControl,
            pageModel:PageModel,
            textTypesModel:TextTypesModel,
            queryContextModel:QueryContextModel,
            qsPlugin:PluginInterfaces.QuerySuggest.IPlugin,
            props:FilterFormProperties,
            syncInitialArgs:formArgs.FilterFormArgs) {
        const queries:{[sourceId:string]:AnyQuery} = {
            ...importFormValues(props)
        };
        const attrHelper = new AttrHelper( // TODO this is only for the primary corpus
            props.attrList,
            props.structAttrList,
            props.structList,
            props.tagsets
        );
        super(
            dispatcher,
            pageModel,
            textTypesModel,
            queryContextModel,
            qsPlugin,
            attrHelper,
            'filter-form-model',
            {
                formType: Kontext.ConcFormTypes.FILTER,
                forcedAttr: '', // TODO
                attrList: [...props.attrList],
                structAttrList: [...props.structAttrList],
                wPoSList: [], // TODO
                currentAction: 'filter_form',
                queries, // corpname|filter_id -> query
                cqlEditorMessages: {},
                useRichQueryEditor: props.useRichQueryEditor,
                tagsets: props.tagsets,
                maincorps: {...props.maincorps},
                downArrowTriggersHistory: pipe(
                    queries,
                    Dict.map(v => true),
                ),
                currentSubcorp: pageModel.getCorpusIdent().usesubcorp,
                lposValues: {...props.currLposValues},
                pnFilterValues: {...props.currPnFilterValues},
                filflValues: {...props.currFilflVlaues},
                filfposValues: pipe(
                    props.currFilfposValues,
                    Dict.map((v, fid) => Kontext.newFormValue(v, true))
                ),
                filtposValues: pipe(
                    props.currFiltposValues,
                    Dict.map((v, fid) => Kontext.newFormValue(v, true)),
                ),
                inclkwicValues: {...props.currInclkwicValues},
                opLocks: {...props.opLocks},
                activeWidgets: pipe(
                    props.filters,
                    List.map(item => tuple(item, null)),
                    Dict.fromEntries()
                ),
                withinArgs: {...props.withinArgValues},
                hasLemma: {...props.hasLemma},
                inputLanguage: props.inputLanguage,
                isAnonymousUser: props.isAnonymousUser,
                supportedWidgets: determineFilterTagWidgets(
                    queries,
                    props.tagsets,
                    props.isAnonymousUser
                ),
                contextFormVisible: false,    // TODO load from some previous state?
                textTypesFormVisible: false,  // dtto
                queryOptionsVisible: pipe(
                    props.filters,
                    List.map(item => tuple(item, true)),
                    Dict.fromEntries()
                ),    // dtto
                historyVisible: pipe(
                    queries,
                    Dict.keys(),
                    List.map(k => tuple(k, false)),
                    Dict.fromEntries()
                ),
                suggestionsVisible: pipe(
                    queries,
                    Dict.keys(),
                    List.map(k => tuple(k, null)),
                    Dict.fromEntries()
                ),
                suggestionsConfigured: props.suggestionsConfigured,
                suggestionsEnabled: pipe(
                    queries,
                    Dict.map(
                        query => suggestionsEnabled(
                            qsPlugin,
                            props.suggestionsConfigured,
                            Kontext.ConcFormTypes.QUERY,
                            query
                        )
                    )
                ),
                suggestionsLoading: pipe(
                    queries,
                    Dict.keys(),
                    List.map(k => tuple(k, {})),
                    Dict.fromEntries()
                ),
                isBusy: false,
                simpleQueryDefaultAttrs: props.simpleQueryDefaultAttrs,
                isLocalUiLang: props.isLocalUiLang,
                changeMaincorp: undefined
        });
        this.syncInitialArgs = syncInitialArgs;
        this.addActionHandler<typeof MainMenuActions.ShowFilter>(
            MainMenuActions.ShowFilter.name,
            action => {
                this.changeState(state => {
                    state.changeMaincorp = action.payload.maincorp
                });

                this.syncFrom(rxOf({...this.syncInitialArgs, ...action.payload})).subscribe({
                    error: (err) => {
                        this.pageModel.showMessage('error',
                                `Failed to synchronize filter model: ${err}`);
                    }
                });
            }
        );

        this.addActionSubtypeHandler<typeof Actions.QueryInputSetLpos>(
            Actions.QueryInputSetLpos.name,
            action => action.payload.formType === 'filter',
            action => {
                this.changeState(state => {
                    state.lposValues[action.payload.sourceId] = action.payload.lpos;
                });
            }
        );

        this.addActionHandler<typeof Actions.FilterInputSetFilfl>(
            Actions.FilterInputSetFilfl.name,
            action => {
                this.changeState(state => {
                    state.filflValues[action.payload.filterId] = action.payload.value;
                });
            }
        );

        this.addActionHandler<typeof Actions.FilterInputSetRange>(
            Actions.FilterInputSetRange.name,
            action => {
                this.changeState(state => {
                    this.setFilPosValue(
                        state,
                        action.payload.filterId,
                        action.payload.value,
                        action.payload.rangeId
                    );
                });
            }
        );

        this.addActionHandler<typeof Actions.FilterInputSetInclKwic>(
            Actions.FilterInputSetInclKwic.name,
            action => {
                this.changeState(state => {
                    state.inclkwicValues[action.payload.filterId] = action.payload.value;
                    state.pnFilterValues[action.payload.filterId] = pnfilterInclKwicConv(
                        state.pnFilterValues[action.payload.filterId],
                        action.payload.value
                    );
                });
            }
        );

        this.addActionHandler<typeof Actions.ApplyFilter>(
            Actions.ApplyFilter.name,
            action => {
                let err:Error;
                this.changeState(state => {
                    err = this.validateForm(state, action.payload.filterId);
                    if (err) {
                        return;
                    }
                    err = this.testQueryNonEmpty(action.payload.filterId);
                    if (err) {
                        return;
                    }
                    err = this.testQueryTypeMismatch();
                });
                if (!err) {
                    this.changeState(state => {
                        state.isBusy = true;
                    });
                    this.submitQuery(
                        action.payload.filterId,
                        List.head(this.pageModel.getConcArgs().q).substr(1)
                    ).pipe(
                        tap(
                            (data) => {
                                this.pageModel.updateConcPersistenceId(data.conc_persistence_op_id);
                                this.changeState(state => {
                                    state.isBusy = false;
                                });
                            }
                        )
                    ).subscribe({
                        next: data => {
                            dispatcher.dispatch<typeof ConcActions.AddedNewOperation>({
                                name: ConcActions.AddedNewOperation.name,
                                payload: {
                                    concId: data.conc_persistence_op_id,
                                    changeMaincorp: this.state.changeMaincorp,
                                    data
                                }
                            });

                        },
                        error: err => {
                            this.pageModel.showMessage('error', err);
                            this.changeState(state => {
                                state.isBusy = false;
                            });
                        }
                    });

                } else {
                    this.pageModel.showMessage('error', err);
                }
            }
        );

        this.addActionHandler<typeof Actions.QueryContextToggleForm>(
            Actions.QueryContextToggleForm.name,
            action => {
                this.changeState(state => {
                    state.contextFormVisible = !state.contextFormVisible;
                });
            }
        );

        this.addActionHandler<typeof Actions.QueryTextTypesToggleForm>(
            Actions.QueryTextTypesToggleForm.name,
            action => {
                this.changeState(state => {
                    state.textTypesFormVisible = !state.textTypesFormVisible;
                });
            }
        );

        this.addActionHandler<typeof Actions.FilterInputSetFilterType>(
            Actions.FilterInputSetFilterType.name,
            action => {
                this.changeState(state => {
                      state.pnFilterValues[action.payload.filterId] = action.payload.value;
                });
            }
        )
    }

    private validateForm(state:FilterFormModelState, filterId:string):Error|null {
        if (validateNumber(state.filfposValues[filterId].value)) {
            state.filfposValues[filterId] = setFormItemInvalid(
                state.filfposValues[filterId], false);

        } else {
            state.filfposValues[filterId] = setFormItemInvalid(
                state.filfposValues[filterId], true);
            return new Error(this.pageModel.translate('global__invalid_number_format'));
        }

        if (validateNumber(state.filtposValues[filterId].value)) {
            state.filtposValues[filterId] = setFormItemInvalid(
                state.filtposValues[filterId], false);

        } else {
            state.filtposValues[filterId] = setFormItemInvalid(
                state.filtposValues[filterId], true);
            return new Error(this.pageModel.translate('global__invalid_number_format'));
        }
    }

    private setFilPosValue(state:FilterFormModelState, filterId:string, value:string,
            rangeId:string):void {
        if (rangeId === 'filfpos') {
            state.filfposValues[filterId] = {
                value,
                isInvalid: false,
                isRequired: true
            };

        } else if (rangeId === 'filtpos') {
            state.filtposValues[filterId] = {
                value,
                isInvalid: false,
                isRequired: true
            };
        }
    }

    getTagsets(state:FilterFormModelState):{[sourceId:string]:Array<PluginInterfaces.TagHelper.TagsetInfo>} {
        return pipe(
            state.queries,
            Dict.keys(),
            List.map(q => tuple(q, state.tagsets)),
            Dict.fromEntries()
        );
    }

    /**
     * Synchronize user input values from an external source
     * (typically a server response or a local cache).
     */
    syncFrom(fn:Observable<formArgs.FilterFormArgs>):Observable<formArgs.FilterFormArgs> {
        return fn.pipe(
            tap(
                (data) => {
                    const filterId = data.op_key;
                    if (data.form_type === Kontext.ConcFormTypes.FILTER) {
                        this.changeState(state => {
                            state.queries = {...state.queries, ...importFormValues(data, filterId)};
                            state.maincorps[filterId] = data.maincorp;
                            state.pnFilterValues[filterId] = data.pnfilter;
                            state.filflValues[filterId] = data.filfl;
                            state.filfposValues[filterId] = {
                                value: data.filfpos,
                                isInvalid: false,
                                isRequired: true
                            };
                            state.filtposValues[filterId] = {
                                value: data.filtpos,
                                isInvalid: false,
                                isRequired: true
                            };
                            state.inclkwicValues[filterId] = data.inclkwic;
                            state.tagsets = data.tagsets;
                            state.withinArgs[filterId] = data.within;
                            state.lposValues[filterId] = data.lpos;
                            state.hasLemma[filterId] = data.has_lemma;
                            state.opLocks[filterId] = false;
                            state.supportedWidgets = determineSupportedWidgets(
                                state.queries,
                                getTagBuilderSupport(this.getTagsets(state)),
                                state.isAnonymousUser
                            );
                            // set of default attrs for the simple query will be always the same (same corpus):
                            state.simpleQueryDefaultAttrs[filterId] = state.simpleQueryDefaultAttrs['__new__']
                        });

                    } else if (data.form_type === Kontext.ConcFormTypes.LOCKED ||
                            data.form_type === Kontext.ConcFormTypes.LGROUP) {
                        this.changeState(state => {
                            state.opLocks[filterId] = true;
                        });

                    } else {
                        throw new Error(
                            'Cannot sync filter model - invalid form data type: ' + data.form_type);
                    }
                }
            )
        );
    }

    private createSubmitArgs(filterId:string, concId:string):FilterServerArgs {
        const query = this.state.queries[filterId];
        return {
            type: 'filterQueryArgs',
            qtype: query.qtype,
            query: query.query,
            queryParsed: query.qtype === 'simple' ?
                pipe(
                    query.queryParsed,
                    List.map(
                        item => tuple(
                            item.args.length > 0 && item.args[0][0] ?
                                item.args :
                                [tuple(query.default_attr, item.args[0][1])],
                            item.isExtended
                        )
                    )
                ) :
                undefined,
            default_attr: query.default_attr,
            qmcase: query.qtype === 'simple' ? query.qmcase : false,
            use_regexp: query.qtype === 'simple' ? query.use_regexp : false,
            pnfilter: this.state.pnFilterValues[filterId],
            filfl: this.state.filflValues[filterId],
            filfpos: this.state.filfposValues[filterId].value,
            filtpos: this.state.filtposValues[filterId].value,
            inclkwic: this.state.inclkwicValues[filterId],
            within: this.state.withinArgs[filterId],
            ...this.pageModel.getConcArgs(),
            q: ['~' + concId]
        }
    }

    /**
     *
     * @param filterId id of filter operation (__new__ for new, conc ID if already applied)
     * @param concId concID we want to attach the submit to (it may or may not be equal to filterId)
     */
    submitQuery(filterId:string, concId:string):Observable<AjaxConcResponse> {
        const args = this.createSubmitArgs(filterId, concId);
        return this.pageModel.ajax$<AjaxConcResponse>(
            HTTP.Method.POST,
            this.pageModel.createActionUrl(
                'filter',
                {
                    format: 'json',
                    q: ['~' + concId]
                }
            ),
            args,
            {
                contentType: 'application/json'
            }
        );
    }
}
