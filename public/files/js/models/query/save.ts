/*
 * Copyright (c) 2017 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2017 Tomas Machalek <tomas.machalek@gmail.com>
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

import { PageModel } from '../../app/page';
import * as Kontext from '../../types/kontext';
import { StatelessModel, IActionDispatcher, SEDispatcher } from 'kombo';
import { concatMap, debounceTime, map, Observable, of as rxOf, Subject } from 'rxjs';
import { Actions } from './actions';
import { Actions as ConcActions } from '../concordance/actions';
import { HTTP } from 'cnc-tskit';
import { SaveItemResponse } from '../searchHistory/common';
import * as copy from 'copy-to-clipboard';


interface IsArchivedResponse extends Kontext.AjaxResponse {
    is_archived:boolean;
    will_be_archived:boolean;
}

interface MakePermanentResponse extends Kontext.AjaxResponse {
    revoked:boolean;
}

export interface QuerySaveAsFormModelState {

    queryId:string;
    name:string;
    isBusy:boolean;
    isValidated:boolean;
    concTTLDays:number;
    concIsArchived:boolean;
    willBeArchived:boolean;
    userQueryId:string;
    userQueryIdMsg:Array<string>;
    userQueryIdValid:boolean;
    userQueryIdIsBusy:boolean;
    userQueryIdSubmit:boolean;
}

/**
 *
 */
export class QuerySaveAsFormModel extends StatelessModel<QuerySaveAsFormModelState> {

    QUERY_ID_CHECK_INTERVAL_MS = 350;

    private layoutModel:PageModel;

    private userQueryValidator:RegExp;

    private readonly debouncedIdCheck$:Subject<null|string>;

    constructor(
        dispatcher:IActionDispatcher,
        layoutModel:PageModel,
        queryId:string,
        concTTLDays:number
    ) {
        super(
            dispatcher,
            {
                name: '',
                isBusy: false,
                queryId,
                isValidated: false,
                concTTLDays,
                concIsArchived: false,
                willBeArchived: false,
                userQueryId: '',
                userQueryIdMsg: [],
                userQueryIdValid: true,
                userQueryIdIsBusy: false,
                userQueryIdSubmit: false,
            }
        );
        this.layoutModel = layoutModel;
        this.userQueryValidator = new RegExp('[^a-zA-Z0-9_-]+');

        this.debouncedIdCheck$ = new Subject();
        this.debouncedIdCheck$.pipe(
            debounceTime(this.QUERY_ID_CHECK_INTERVAL_MS)

        ).subscribe({
            next: id => {
                if (id) {
                    this.checkIdExists(id).subscribe({
                        next: data => {
                            dispatcher.dispatch(
                                Actions.UserQueryIdAvailable,
                                data,
                            );
                        },
                        error: error => {
                            dispatcher.dispatch(
                                Actions.UserQueryIdAvailable,
                                {},
                                error,
                            );
                        }
                    });
                }
            }
        });

        this.addActionHandler(
            Actions.SaveAsFormSetName,
            (state, action) => {
                state.name = action.payload.value;
            }
        );

        this.addActionHandler(
            Actions.SaveAsFormSubmit,
            (state, action) => {
                if (state.name) {
                    state.isValidated = true;
                    state.isBusy = true;

                } else {
                    state.isValidated = false;
                }
            },
            (state, action, dispatch) => {
                if (!state.isValidated) {
                    this.layoutModel.showMessage('error',
                            this.layoutModel.translate('query__save_as_cannot_have_empty_name'));

                } else {
                    this.submit(state).subscribe({
                        next: () => {
                            this.layoutModel.resetMenuActiveItemAndNotify();
                            dispatch<typeof Actions.SaveAsFormSubmitDone>({
                                name: Actions.SaveAsFormSubmitDone.name
                            });
                        },
                        error: (err) => {
                            this.layoutModel.showMessage('error', err);
                            dispatch<typeof Actions.SaveAsFormSubmitDone>({
                                name: Actions.SaveAsFormSubmitDone.name
                            });
                        }
                    });
                }
            }
        );

        this.addActionHandler(
            Actions.SaveAsFormSubmitDone,
            (state, action) => {
                state.isBusy = false;
                // TODO these are side-effects actually
                if (action.error) {
                    this.layoutModel.showMessage('error', action.error);

                } else {
                    this.layoutModel.showMessage('info',
                        this.layoutModel.translate('query__save_as_item_saved'));
                }
            }
        );

        this.addActionHandler(
            ConcActions.AddedNewOperation,
            (state, action) => {
                state.concIsArchived = false;
                state.willBeArchived = false;
                state.queryId = action.payload?.concId;
            }
        );

        this.addActionHandler(
            Actions.GetConcArchivedStatus,
            (state, action) => {
                state.isBusy = true;
            },
            (state, action, dispatch) => {
                this.loadStatus(state.queryId, dispatch).subscribe({
                    next: data => {
                        dispatch<typeof Actions.GetConcArchivedStatusDone>({
                            name: Actions.GetConcArchivedStatusDone.name,
                            payload: {
                                willBeArchived: data.will_be_archived,
                                isArchived: data.is_archived
                            }
                        });

                    },
                    error: error => {
                        dispatch<typeof Actions.GetConcArchivedStatusDone>({
                            name: Actions.GetConcArchivedStatusDone.name,
                            error
                        });
                    }
                });
            }
        );

        this.addActionHandler(
            Actions.GetConcArchivedStatusDone,
            (state, action) => {
                state.isBusy = false;
                state.concIsArchived = action.payload.isArchived;
                state.willBeArchived = action.payload.willBeArchived;
            }
        );

        this.addActionHandler(
            Actions.MakeConcordancePermanent,
            (state, action) => {
                state.isBusy = true;
            },
            (state, action, dispatch) => {
                this.layoutModel.ajax$<MakePermanentResponse>(
                    HTTP.Method.POST,
                    this.layoutModel.createActionUrl(
                        'archive_concordance',
                        {
                            code: state.queryId,
                            revoke: action.payload.revoke
                        }
                    ),
                    {}

                ).pipe(
                    concatMap(_ => this.loadStatus(state.queryId, dispatch))

                ).subscribe({
                    next: data => {
                        dispatch<typeof Actions.MakeConcordancePermanentDone>({
                            name: Actions.MakeConcordancePermanentDone.name,
                            payload: {
                                willBeArchived: data.will_be_archived,
                                isArchived: data.is_archived
                            }
                        });

                    },
                    error: error => {
                        dispatch<typeof Actions.MakeConcordancePermanentDone>({
                            name: Actions.MakeConcordancePermanentDone.name,
                            error
                        });
                    }
                });
            }
        );

        this.addActionHandler(
            Actions.MakeConcordancePermanentDone,
            (state, action) => {
                state.isBusy = false;
                if (action.error) {
                    this.layoutModel.showMessage('error', action.error);

                } else {
                    state.concIsArchived = action.payload.isArchived;
                    state.willBeArchived = action.payload.willBeArchived;
                    if (!action.payload.isArchived && !action.payload.willBeArchived) {
                        this.layoutModel.showMessage(
                            'info',
                            this.layoutModel.translate('concview__make_conc_link_permanent_revoked')
                        );

                    } else {
                        this.layoutModel.showMessage(
                            'info',
                            this.layoutModel.translate('concview__make_conc_link_permanent_done')
                        );
                    }
                }
            }
        );

        this.addActionHandler(
            Actions.CopyPermalinkToClipboard,
            null,
            (state, action, dispatch) => {
                copy(action.payload.url);
                this.layoutModel.showMessage(
                    'info', this.layoutModel.translate('global__link_copied_to_clipboard'));
            }
        );

        this.addActionHandler(
            Actions.UserQueryIdChange,
            (state, action) => {
                state.userQueryId = action.payload.value;
                state.userQueryIdMsg = [];
                state.userQueryIdValid = true;
                if (action.payload.value.length > 191) {
                    state.userQueryIdValid = false;
                    state.userQueryIdMsg.push(this.layoutModel.translate('concview__create_new_id_msg_too_long'));
                }
                if (this.userQueryValidator.test(action.payload.value)) {
                    state.userQueryIdValid = false;
                    state.userQueryIdMsg.push(this.layoutModel.translate('concview__create_new_id_msg_invalid_chars'));
                }

                if (state.userQueryId.length > 0 && state.userQueryIdValid) {
                    state.userQueryIdMsg = [this.layoutModel.translate('concview__create_new_id_msg_checking_availability')]
                    state.userQueryIdIsBusy = true;
                    this.debouncedIdCheck$.next(state.userQueryId);

                } else {
                    state.userQueryIdIsBusy = false;
                    this.debouncedIdCheck$.next(null);
                }
            }
        );

        this.addActionHandler(
            Actions.UserQueryIdSubmit,
            (state, action) => {
                state.userQueryIdIsBusy = true;
                state.userQueryIdSubmit = true;
            },
            (state, action, dispatch) => {
                this.renameQuery(state.queryId, state.userQueryId, dispatch);
            }
        );

        this.addActionHandler(
            Actions.UserQueryIdSubmitDone,
            (state, action) => {
                if (action.error) {
                    state.userQueryIdIsBusy = false;
                    state.userQueryIdSubmit = false;
                    this.layoutModel.showMessage('error', action.error);
                } else {
                    window.location.href = this.layoutModel.createActionUrl('view', {q: `~${action.payload.id}`}) + '#show_permalink';
                }
            },
        );

        this.addActionHandler(
            Actions.UserQueryIdAvailable,
            (state, action) => {
                state.userQueryIdIsBusy = false;
                state.userQueryIdMsg = [];
                if (action.error) {
                    this.layoutModel.showMessage('error', action.error);
                    state.userQueryIdValid = false;

                } else if (!action.payload.available) {
                    state.userQueryIdValid = false;
                    if (action.payload.pattern) {
                        state.userQueryIdMsg.push(this.layoutModel.translate(
                            'concview__create_new_id_msg_reserved_{pattern}',
                            {pattern: action.payload.pattern},
                        ));

                    } else {
                        state.userQueryIdMsg.push(
                            this.layoutModel.translate('concview__create_new_id_msg_unavailable')
                        );
                    }
                }
            },
        );
    }

    private loadStatus(queryId:string, dispatch:SEDispatcher):Observable<IsArchivedResponse> {
        return this.layoutModel.ajax$<IsArchivedResponse>(
            HTTP.Method.GET,
            this.layoutModel.createActionUrl('get_stored_conc_archived_status'),
            {code: queryId}

        );
    }

    private submit(state:QuerySaveAsFormModelState):Observable<boolean> {
        return this.layoutModel.ajax$<SaveItemResponse>(
            HTTP.Method.POST,
            this.layoutModel.createActionUrl('save_query'),
            {
                query_id: state.queryId,
                name: state.name
            },
            {contentType: 'application/json'}

        ).pipe(
            map(
                resp => resp.saved
            )
        );
    }

    private checkIdExists(queryId:string) {
        return this.layoutModel.ajax$<{id:string; available:boolean; pattern:string;}>(
            HTTP.Method.GET,
            this.layoutModel.createActionUrl('query_id_available'),
            {id: queryId},

        );
    }

    private renameQuery(queryId:string, newQueryId:string, dispatch:SEDispatcher) {
        this.layoutModel.ajax$<{ok: boolean; id: string;}>(
            HTTP.Method.POST,
            this.layoutModel.createActionUrl('create_query_id'),
            {
                old: queryId,
                new: newQueryId,
            },
            {contentType: 'application/json'},

        ).subscribe({
            next: data => {
                dispatch(
                    Actions.UserQueryIdSubmitDone,
                    data,
                );

            },
            error: error => {
                dispatch(
                    Actions.UserQueryIdSubmitDone,
                    {},
                    error,
                );
            }
        });
    }
}
