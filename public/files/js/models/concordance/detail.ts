/*
 * Copyright (c) 2016 Charles University, Faculty of Arts,
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

import { IFullActionControl, StatefulModel } from 'kombo';
import { Observable, of as rxOf, forkJoin } from 'rxjs';
import { tap, map } from 'rxjs/operators';
import { Color, List, pipe, Dict, HTTP } from 'cnc-tskit';

import { MultiDict } from '../../multidict';
import { PluginInterfaces } from '../../types/plugins';
import { AjaxResponse } from '../../types/ajaxResponses';
import { PageModel } from '../../app/page';
import { AudioPlayer } from './media';
import { Actions as ViewOptionsActions, ActionName as ViewOptionsActionName } from '../options/actions';
import { Actions, ActionName } from './actions';
import { DetailExpandPositions } from './common';

/**
 *
 */
export type ConcDetailText = Array<{str:string; class:string}>;


/**
 *
 */
export interface Speech {
    text:ConcDetailText;
    speakerId:string;
    segments:Array<string>;
    colorCode:Color.RGBA;
    metadata:{[ident:string]:string};
}

/**
 * Note: A single speech line contains an array of
 * simultaneous speeches (i.e. if two people speak
 * at the same time then the array contains two items).
 */
export type SpeechLine = Array<Speech>;

export type SpeechLines = Array<SpeechLine>;


type ExpandArgs = [number, number];


export interface SpeechOptions {
    speakerIdAttr:[string, string];
    speechSegment:[string, string];
    speechAttrs:Array<string>;
    speechOverlapAttr:[string, string];
    speechOverlapVal:string;
}

export interface ConcDetailModelState {

    concDetail:ConcDetailText;

    expandLeftArgs:Array<ExpandArgs>;

    expandRightArgs:Array<ExpandArgs>;

    corpusId:string;

    kwicTokenNum:number;

    tokenConnectData:PluginInterfaces.TokenConnect.TCData;

    kwicLength:number;

    lineIdx:number;

    wholeDocumentLoaded:boolean;

    structCtx:string;

    speechOpts:SpeechOptions;

    speechAttrs:Array<string>;

    speechDetail:SpeechLines;

    playingRowIdx:number;

    speakerColors:Array<Color.RGBA>;

    wideCtxGlobals:Array<[string, string]>;

    spkOverlapMode:string;

    /**
     * Either 'default' or 'speech'.
     * An initial mode is inferred from speechOpts
     * (see constructor).
     */
    mode:string;

    /**
     * Speaker colors attachments must survive context expansion.
     * Otherwise it would confusing if e.g. green speaker '01'
     * changed into red one after a context expasion due to
     * some new incoming or outcoming users.
     */
    speakerColorsAttachments:{[ident:string]:Color.RGBA};

    isBusy:boolean;

    tokenConnectIsBusy:boolean;

    /**
     * Currently expanded side. In case the model is not busy the
     * value represent last expanded side (it is not reset after expansion).
     * Values: 'left', 'right' or a custom value generated by TC plugin
     */
    expandingSide:DetailExpandPositions|null;
}

/**
 * A model providing access to a detailed/extended kwic information.
 */
export class ConcDetailModel extends StatefulModel<ConcDetailModelState> {

    private static SPK_LABEL_OPACITY:number = 0.8;

    private static ATTR_NAME_ALLOWED_CHARS:string = 'a-zA-Z0-9_';

    private static SPK_OVERLAP_MODE_FULL:string = 'full';

    private static SPK_OVERLAP_MODE_SIMPLE:string = 'simple';

    private readonly layoutModel:PageModel;

    private readonly audioPlayer:AudioPlayer;

    private readonly tokenConnectPlg:PluginInterfaces.TokenConnect.IPlugin;


    constructor(
        layoutModel:PageModel,
        dispatcher:IFullActionControl,
        structCtx:string,
        speechOpts:SpeechOptions,
        wideCtxGlobals:Array<[string, string]>,
        tokenConnectPlg:PluginInterfaces.TokenConnect.IPlugin
    ) {
        super(
            dispatcher,
            {
                structCtx,
                speechOpts,
                mode: speechOpts.speakerIdAttr ? 'speech' : 'default',
                speechAttrs: speechOpts.speechAttrs,
                wideCtxGlobals,
                lineIdx: null,
                playingRowIdx: -1,
                wholeDocumentLoaded: false,
                speakerColors: List.map(
                    item => Color.importColor(ConcDetailModel.SPK_LABEL_OPACITY, item),
                    ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
                    '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'] // TODO
                ),
                speakerColorsAttachments: {},
                spkOverlapMode: (speechOpts.speechOverlapAttr || [])[1] ?
                        ConcDetailModel.SPK_OVERLAP_MODE_FULL :
                        ConcDetailModel.SPK_OVERLAP_MODE_SIMPLE,
                expandLeftArgs: [],
                expandRightArgs: [],
                tokenConnectData: {
                    token: null,
                    renders: []
                },
                concDetail: [],
                speechDetail: [],
                isBusy: false,
                tokenConnectIsBusy: false,
                corpusId: layoutModel.getCorpusIdent().id,
                expandingSide: null,
                kwicLength: 1,
                kwicTokenNum: -1
            }
        );
        this.layoutModel = layoutModel;
        this.tokenConnectPlg = tokenConnectPlg;
        this.audioPlayer = new AudioPlayer(
            this.layoutModel.createStaticUrl('misc/soundmanager2/'),
            () => {
                this.emitChange();
            },
            () => {
                this.changeState(state => {
                    state.playingRowIdx = -1;
                });
            },
            () => {
                this.changeState(state => {
                    state.playingRowIdx = -1;
                });
                this.audioPlayer.stop();
                this.layoutModel.showMessage('error',
                        this.layoutModel.translate('concview__failed_to_play_audio'));
            }
        );

        this.addActionHandler<Actions.ExpandKwicDetail>(
            ActionName.ExpandKwicDetail,
            action => {
                this.changeState(state => {
                    state.expandingSide = action.payload.position;
                    state.isBusy = true;
                });
                this.loadConcDetail(
                        [],
                        action.payload.position
                ).subscribe(
                    () => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.ShowKwicDetail>(
            ActionName.ShowKwicDetail,
            action => {
                this.changeState(state => {
                    state.isBusy = true;
                    state.tokenConnectIsBusy = true;
                    state.expandLeftArgs = Array<ExpandArgs>();
                    state.expandRightArgs = Array<ExpandArgs>();
                    state.corpusId = action.payload.corpusId;
                    state.kwicTokenNum = action.payload.tokenNumber;
                    state.kwicLength = action.payload.kwicLength;
                    state.lineIdx = action.payload.lineIdx;
                    state.wholeDocumentLoaded = false;
                });
                forkJoin(
                    this.loadConcDetail(
                        [],
                        this.state.expandLeftArgs.length > 1 &&
                                this.state.expandRightArgs.length > 1 ? 'reload' : null
                    ),
                    this.loadTokenConnect(
                        action.payload.corpusId,
                        action.payload.tokenNumber,
                        action.payload.kwicLength,
                        action.payload.lineIdx
                    )

                ).subscribe(
                    () => {
                        this.changeState(state => {
                            state.isBusy = false;
                            state.tokenConnectIsBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.isBusy = false;
                            state.tokenConnectIsBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.ShowTokenDetail>(
            ActionName.ShowTokenDetail,
            action => {
                this.changeState(state => {
                    this.resetKwicDetail(state);
                    this.resetTokenConnect(state);
                    state.tokenConnectIsBusy = true;
                });
                this.loadTokenConnect(
                    action.payload.corpusId,
                    action.payload.tokenNumber,
                    1,
                    action.payload.lineIdx

                ).subscribe(
                    () => {
                        this.changeState(state => {
                            state.tokenConnectIsBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.tokenConnectIsBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );

            }
        );

        this.addActionHandler<Actions.ShowWholeDocument>(
            ActionName.ShowWholeDocument,
            action => {
                this.loadWholeDocument().subscribe(
                    () => {
                        this.emitChange();
                    },
                    (err) => {
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.ShowSpeechDetail>(
            ActionName.ShowSpeechDetail,
            action => {
                this.changeState(state => {
                    state.mode = 'speech';
                    state.expandLeftArgs = [];
                    state.expandRightArgs = [];
                    state.speakerColorsAttachments = {};
                    state.isBusy = true;
                });
                this.loadSpeechDetail(this.state.expandLeftArgs.length > 1 &&
                            this.state.expandRightArgs.length > 1 ? 'reload' : null
                ).subscribe(
                    () => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.ExpandSpeechDetail>(
            ActionName.ExpandSpeechDetail,
            action => {
                this.changeState(state => {
                    state.expandingSide = action.payload.position;
                    state.isBusy = true;
                });
                this.loadSpeechDetail(action.payload.position).subscribe(
                    () => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.DetailSwitchMode>(
            ActionName.DetailSwitchMode,
            action => {
                (() => {
                    if (action.payload.value === 'default') {
                        this.changeState(state => {
                            state.mode = 'default';
                            state.expandLeftArgs = Array<ExpandArgs>();
                            state.expandRightArgs = Array<ExpandArgs>();
                            state.expandingSide = null;
                            state.concDetail = [];
                            state.isBusy = true;
                        });
                        return this.reloadConcDetail();

                    } else if (action.payload.value === 'speech') {
                        this.changeState(state => {
                            state.mode = 'speech';
                            state.expandLeftArgs = [];
                            state.expandRightArgs = [];
                            state.speakerColorsAttachments = {};
                            state.expandingSide = null;
                            state.concDetail = null;
                            state.isBusy = true;
                        });
                        return this.loadSpeechDetail();

                    } else {
                        this.changeState(state => {
                            state.mode = action.payload.value;
                            state.expandLeftArgs = [];
                            state.expandRightArgs = [];
                            state.expandingSide = null;
                            state.concDetail = [];
                            state.isBusy = true;
                        });
                        return rxOf(null);
                    }
                })().subscribe(
                    () => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                    },
                    (err) => {
                        this.changeState(state => {
                            state.isBusy = false;
                        });
                        this.layoutModel.showMessage('error', err);
                    }
                );
            }
        );

        this.addActionHandler<Actions.ResetDetail>(
            [
                ActionName.ResetDetail,
                ActionName.ShowRefDetail
            ],
            action => {
                this.changeState(state => {
                    this.resetKwicDetail(state);
                    this.resetTokenConnect(state);
                });
            }
        );

        this.addActionHandler<Actions.PlaySpeech>(
            ActionName.PlaySpeech,
            action => {
                if (this.state.playingRowIdx > -1) {
                    this.changeState(state => {
                        state.playingRowIdx = null;
                    });
                    this.audioPlayer.stop();
                }
                this.changeState(state => {
                    state.playingRowIdx = action.payload.rowIdx;
                });
                const itemsToPlay = List.map(
                        item => this.layoutModel.createActionUrl(
                            `audio?corpname=${this.state.corpusId}&chunk=${item}`),
                        action.payload.segments
                );
                if (itemsToPlay.length > 0) {
                    this.audioPlayer.start(itemsToPlay);

                } else {
                    this.changeState(state => {
                        state.playingRowIdx = -1;
                    });
                    this.layoutModel.showMessage('error',
                            this.layoutModel.translate('concview__nothing_to_play'));
                }
            }
        );

        this.addActionHandler<Actions.StopSpeech>(
            ActionName.StopSpeech,
            action => {
                if (this.state.playingRowIdx > -1) {
                    this.changeState(state => {
                        state.playingRowIdx = null;
                    });
                    this.audioPlayer.stop();
                }
            }
        );

        this.addActionHandler<ViewOptionsActions.SaveSettingsDone>(
            ViewOptionsActionName.SaveSettingsDone,
            action => {
                this.changeState(state => {
                    state.wideCtxGlobals = action.payload.widectxGlobals;
                });
            }
        );
    }

    private resetKwicDetail(state:ConcDetailModelState):void {
        if (state.lineIdx !== null) {
            state.lineIdx = null;
            state.corpusId = null;
            state.kwicTokenNum = null;
            state.kwicLength = null;
            state.wholeDocumentLoaded = false;
            state.expandLeftArgs = [];
            state.expandRightArgs = [];
            state.speakerColorsAttachments = {};
            state.concDetail = [];
        }
    }

    private resetTokenConnect(state:ConcDetailModelState):void {
        state.tokenConnectData = {
            token: null,
            renders: []
        };
    }

    private generateSpeechesDetail(state:ConcDetailModelState):SpeechLines {

        const parseTag = (name:string, s:string):{[key:string]:string} => {
            const srch = new RegExp(`<${name}(\\s+[^>]+)>`).exec(s);
            if (srch) {
                const ans:{[key:string]:string} = {};
                const items = srch[1].trim()
                    .split(new RegExp(`([${ConcDetailModel.ATTR_NAME_ALLOWED_CHARS}]+)=`)).slice(1);
                for (let i = 0; i < items.length; i += 2) {
                        ans[items[i]] = (items[i+1] || '').trim();
                }
                return ans;
            }
            return null;
        };

        const createNewSpeech = (speakerId:string, colorCode:Color.RGBA,
                    metadata:{[attr:string]:string}):Speech => {
            const importedMetadata = pipe(
                metadata,
                Dict.filter((val, attr) => attr !== state.speechOpts.speechSegment[1] &&
                                attr !== state.speechOpts.speakerIdAttr[1]),
            );
            return {
                text: [],
                speakerId,
                segments: [],
                metadata: importedMetadata,
                colorCode
            };
        };

        const isOverlap = (s1:Speech, s2:Speech):boolean => {
            if (s1 && s2 && state.spkOverlapMode === ConcDetailModel.SPK_OVERLAP_MODE_FULL) {
                const flag1 = s1.metadata[state.speechOpts.speechOverlapAttr[1]];
                const flag2 = s2.metadata[state.speechOpts.speechOverlapAttr[1]];
                if (flag1 === flag2
                        && flag2 === state.speechOpts.speechOverlapVal
                        && s1.segments[0] === s2.segments[0]) {
                    return true;
                }
            }
            return false;
        };

        const mergeOverlaps = (speeches:Array<Speech>):SpeechLines => {
            const ans:SpeechLines = [];
            let prevSpeech:Speech = null;
            speeches.forEach((item, i) => {
                if (isOverlap(prevSpeech, item)) {
                    ans[ans.length - 1].push(item);
                    ans[ans.length - 1] = ans[ans.length - 1].sort((s1, s2) => {
                        if (s1.speakerId > s2.speakerId) {
                            return 1;

                        } else if (s1.speakerId < s2.speakerId) {
                            return -1;

                        } else {
                            return 0;
                        }
                    });

                } else {
                    ans.push([item]);
                }
                prevSpeech = item;
            });
            return ans;
        };

        let currSpeech:Speech = createNewSpeech('\u2026', null, {});
        let prevSpeech:Speech = null;
        const tmp:Array<Speech> = [];

        (state.concDetail || []).forEach((item, i) => {
            if (item.class === 'strc') {
                const attrs = parseTag(state.speechOpts.speakerIdAttr[0], item.str);
                if (attrs !== null && attrs[state.speechOpts.speakerIdAttr[1]]) {
                        tmp.push(currSpeech);
                        const newSpeakerId = attrs[state.speechOpts.speakerIdAttr[1]];
                        if (!Dict.hasKey(newSpeakerId, state.speakerColorsAttachments)) {
                            state.speakerColorsAttachments[newSpeakerId] =
                                state.speakerColors[Dict.size(
                                    state.speakerColorsAttachments)]
                        }
                        prevSpeech = currSpeech;
                        currSpeech = createNewSpeech(
                            newSpeakerId,
                            state.speakerColorsAttachments[newSpeakerId],
                            attrs
                        );
                }
                if (item.str.indexOf(`<${state.speechOpts.speechSegment[0]}`) > -1) {
                    const attrs = parseTag(state.speechOpts.speechSegment[0], item.str);
                    if (attrs) {
                        currSpeech.segments.push(attrs[state.speechOpts.speechSegment[1]]);
                    }

                }
                if (state.spkOverlapMode === ConcDetailModel.SPK_OVERLAP_MODE_SIMPLE) {
                    const overlapSrch = new RegExp(
                        `</?(${state.speechOpts.speechOverlapAttr[0]})(>|[^>]+>)`, 'g');
                    let srch = overlapSrch.exec(item.str);
                    let i = 0;
                    while (srch !== null) {
                        if (srch[0].indexOf('</') === 0
                                && item.str.indexOf(
                                    `<${state.speechOpts.speakerIdAttr[0]}`) > 0) {
                            prevSpeech.text.push({str: srch[0], class: item.class});

                        } else {
                            currSpeech.text.push({str: srch[0], class: item.class});
                        }
                        i += 1;
                        srch = overlapSrch.exec(item.str);
                    }
                }

            } else {
                currSpeech.text.push({
                    str: item.str,
                    class: item.class
                });
            }
        });
        if (currSpeech.text.length > 0) {
            tmp.push(currSpeech);
        }
        return mergeOverlaps(tmp);
    }

    /**
     *
     */
    private loadWholeDocument():Observable<any> {
        // TODO if mode speeches or a custom one, throw an error here
        return this.layoutModel.ajax$<AjaxResponse.WideCtx>(
            HTTP.Method.GET,
            this.layoutModel.createActionUrl('structctx'),
            {
                corpname: this.state.corpusId,
                pos: this.state.kwicTokenNum,
                struct: this.state.structCtx
            },
            {}

        ).pipe(
            tap(
                (data) => {
                    this.state.concDetail = data.content;
                    this.state.wholeDocumentLoaded = true;
                    this.state.expandLeftArgs = [];
                    this.state.expandRightArgs = [];
                }
            )
        );
    }

    /**
     *
     */
    private loadSpeechDetail(expand?:string):Observable<boolean> {
        const structs = this.layoutModel.getConcArgs().getList('structs');
        const args = this.state.speechAttrs
                .map(x => `${this.state.speechOpts.speakerIdAttr[0]}.${x}`)
                .concat([this.state.speechOpts.speechSegment.join('.')]);

        const [overlapStruct, overlapAttr] = (this.state.speechOpts.speechOverlapAttr ||
                [undefined, undefined]);
        if (overlapStruct !== this.state.speechOpts.speakerIdAttr[0]
                && structs.indexOf(overlapStruct) === -1) {
            if (overlapStruct && overlapAttr) {
                args.push(`${overlapStruct}.${overlapAttr}`);

            } else if (overlapStruct) {
                args.push(overlapStruct);
            }
        }
        return this.loadConcDetail(args, expand);
    }

    private loadTokenConnect(corpusId:string, tokenNum:number, numTokens:number,
            lineIdx:number):Observable<boolean> {
        return this.tokenConnectPlg.fetchTokenConnect(
            corpusId, tokenNum, numTokens
        ).pipe(
            tap(
                (data) => {
                    if (data) {
                        this.changeState(state => {
                            state.tokenConnectData = data;
                            state.lineIdx = lineIdx;
                        });
                    }
                }
            ),
            map(
                data => !!data
            )
        );
    }

    /**
     *
     */
    private loadConcDetail(structs:Array<string>, expand?:string):Observable<boolean> {

        const args = new MultiDict(this.state.wideCtxGlobals);
        args.set('corpname', this.state.corpusId); // just for sure (is should be already in args)
        // we must delete 'usesubcorp' as the server API does not need it
        // and in case of an aligned corpus it even produces an error
        args.remove('usesubcorp');
        args.set('pos', String(this.state.kwicTokenNum));
        args.set('format', 'json');
        if (this.state.kwicLength && this.state.kwicLength > 1) {
            args.set('hitlen', this.state.kwicLength);
        }

        if (structs) {
            args.set('structs', (args.head('structs') || '').split(',').concat(structs).join(','));
        }

        if (expand === 'left') {
            const [lft, rgt] = List.get(-1, this.state.expandLeftArgs);
            args.set('detail_left_ctx', lft);
            args.set('detail_right_ctx', rgt);

        } else if (expand === 'right') {
            const [lft, rgt] = List.get(-1, this.state.expandRightArgs);
            args.set('detail_left_ctx', lft);
            args.set('detail_right_ctx', rgt);


        } else if (expand === 'reload' && this.state.expandLeftArgs.length > 1
                && this.state.expandRightArgs.length > 1) {
            // Please note that the following lines do not contain any 'left - right'
            // mismatch as we have to fetch the 'current' state, not the 'next' one and such
            // info is always on the other side of expansion (expand-left contains
            // also current right and vice versa)
            args.set('detail_left_ctx', List.get(-1, this.state.expandRightArgs)[0]);
            args.set('detail_right_ctx', List.get(-1, this.state.expandLeftArgs)[1]);
        }

        return this.layoutModel.ajax$<AjaxResponse.WideCtx>(
            HTTP.Method.GET,
            this.layoutModel.createActionUrl('widectx'),
            args,
            {}

        ).pipe(
            tap(
                (data) => {
                    this.changeState(state => {
                        state.concDetail = data.content;
                        if (state.mode === 'speech') {
                            state.speechDetail = this.generateSpeechesDetail(state);
                        }
                        if (data.expand_left_args) {
                            state.expandLeftArgs.push([
                                data.expand_left_args.detail_left_ctx,
                                data.expand_left_args.detail_right_ctx
                            ]);

                        } else {
                            state.expandLeftArgs.push(null);
                        }
                        if (data.expand_right_args) {
                            state.expandRightArgs.push([
                                data.expand_right_args.detail_left_ctx,
                                data.expand_right_args.detail_right_ctx
                            ]);

                        } else {
                            state.expandRightArgs.push(null);
                        }
                    });
                }
            ),
            map(d =>  !!d)
        );
    }

    private reloadConcDetail():Observable<boolean> {
        return this.loadConcDetail([], 'reload');
    }

    static hasExpandLeft(state:ConcDetailModelState):boolean {
        return !!List.get(-1, state.expandLeftArgs);
    }

    static hasExpandRight(state:ConcDetailModelState):boolean {
        return !!List.get(-1, state.expandRightArgs);
    }

    static canDisplayWholeDocument(state:ConcDetailModelState):boolean {
        return state.structCtx && !state.wholeDocumentLoaded;
    }

    supportsTokenConnect():boolean {
        return this.tokenConnectPlg.isActive() && this.tokenConnectPlg.providesAnyTokenInfo();
    }

    static supportsSpeechView(state:ConcDetailModelState):boolean {
        return !!state.speechOpts.speakerIdAttr;
    }
}

