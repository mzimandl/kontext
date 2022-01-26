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

import * as React from 'react';
import * as Kontext from '../../../types/kontext';
import { Dict, List, pipe } from 'cnc-tskit';
import { init as dataRowsInit } from '../dataRows';
import { init as initSaveViews } from './save';
import { init as initChartViews } from '../charts';
import { FreqDataRowsModel, FreqDataRowsModelState } from '../../../models/freqs/regular/table';
import { IActionDispatcher, BoundWithProps } from 'kombo';
import { Actions } from '../../../models/freqs/regular/actions';
import * as S from './style';
import { FreqChartsModel } from '../../../models/freqs/regular/freqCharts';

// --------------------------- exported types --------------------------------------


// ------------------------ factory --------------------------------

export function init(
        dispatcher:IActionDispatcher,
        he:Kontext.ComponentHelpers,
        freqChartsModel:FreqChartsModel,
        freqDataRowsModel:FreqDataRowsModel
) {
    const globalComponents = he.getLayoutViews();
    const drViews = dataRowsInit(dispatcher, he);
    const chartViews = initChartViews(dispatcher, he, freqChartsModel);
    const saveViews = initSaveViews(dispatcher, he, freqDataRowsModel.getSaveModel());


    // ----------------------- <Paginator /> -------------------------

    interface PaginatorProps {
        isLoading:boolean;
        currentPage:string;
        hasNextPage:boolean;
        hasPrevPage:boolean;
        totalPages:number;
        totalItems:number;
        sourceId:string;
    }

    const Paginator:React.FC<PaginatorProps> = (props) => {

        const handlePageChangeByClick = (curr, step) => {
            dispatcher.dispatch<typeof Actions.ResultSetCurrentPage>({
                name: Actions.ResultSetCurrentPage.name,
                payload: {
                    value: String(Number(curr) + step),
                    sourceId: props.sourceId
                }
            });
        };

        const handlePageChange = (evt) => {
            dispatcher.dispatch<typeof Actions.ResultSetCurrentPage>({
                name: Actions.ResultSetCurrentPage.name,
                payload: {
                    value: evt.target.value,
                    sourceId: props.sourceId
                }
            });
        };

        const renderPageNum = () => {
            if (props.isLoading) {
                return <div>
                        <span className="overlay">
                            <img src={he.createStaticUrl('img/ajax-loader-bar.gif')}
                                alt={he.translate('global__loading')} />
                        </span>
                        <input type="text" />
                </div>;

            } else {
                return (
                    <input type="text" value={props.currentPage}
                        title={he.translate('global__curr_page_num')}
                        onChange={handlePageChange}
                        disabled={props.totalPages === 1}
                        style={{width: '3em'}} />
                );
            }
        };

        return (
            <S.Paginator className="ktx-pagination">
                <form>
                    <div className="ktx-pagination-core">
                        <div className="ktx-pagination-left">
                            {props.hasPrevPage ?
                                (<a onClick={(e) => handlePageChangeByClick(props.currentPage, -1)}>
                                    <img className="over-img" src={he.createStaticUrl('img/prev-page.svg')}
                                            alt="další" title="další" />
                                </a>) : null}
                        </div>
                        <span className="curr-page">{renderPageNum()}</span>
                        <span className="numofpages">{'\u00a0/\u00a0'}{props.totalPages}</span>
                        <div className="ktx-pagination-right">
                            {props.hasNextPage ?
                                (<a onClick={(e) => handlePageChangeByClick(props.currentPage, 1)}>
                                    <img className="over-img" src={he.createStaticUrl('img/next-page.svg')}
                                            alt="další" title="další" />
                                </a>) : null}
                        </div>
                    </div>
                </form>
                <div className="desc">
                    ({he.translate('freq__avail_label')}:{'\u00a0'}
                    {he.translate('freq__avail_items_{num_items}', {num_items: props.totalItems})})
                </div>
            </S.Paginator>
        );
    };

    // ----------------------- <MinFreqInput /> -------------------------

    const MinFreqInput:React.FC<{
        minFreqVal:string;

    }> = ({minFreqVal}) => {

        const handleInputChange = (evt:React.ChangeEvent<HTMLInputElement>) => {
            dispatcher.dispatch<typeof Actions.ResultSetMinFreqVal>({
                name: Actions.ResultSetMinFreqVal.name,
                payload: {
                    value: evt.target.value
                }
            });
        };

        return (
            <label>
                {he.translate('freq__limit_input_label')}:
                {'\u00a0'}
                <input type="text" name="flimit" value={minFreqVal}
                        style={{width: '3em'}}
                        onChange={handleInputChange} />
            </label>
        );
    };

    // ----------------------- <FilterForm /> -------------------------

    interface FilterFormProps {
        minFreqVal:string;
    }

    const FilterForm:React.FC<FilterFormProps> = (props) => {

        return (
            <S.FilterForm>
                <MinFreqInput minFreqVal={props.minFreqVal} />
            </S.FilterForm>
        );
    };

    // ----------------------- <FreqResultLoaderView /> --------------------

    const FreqResultLoaderView:React.FC<{sourceId:string}> = ({sourceId}) => {

        React.useEffect(
            () => {
                dispatcher.dispatch<typeof Actions.ReloadData>({
                    name: Actions.ReloadData.name,
                    payload: {
                        sourceId
                    }
                })
            },
            []
        );

        return (
            <S.FreqResultLoaderView>
                <h3>{sourceId}</h3>
                <globalComponents.AjaxLoaderImage />
            </S.FreqResultLoaderView>
        );
    }

    // ----------------------- <FreqResultView /> -------------------------

    const FreqResultView:React.FC<FreqDataRowsModelState> = (props) => {

        const handleSaveFormClose = () => {
            dispatcher.dispatch<typeof Actions.ResultCloseSaveForm>({
                name: Actions.ResultCloseSaveForm.name,
                payload: {}
            });
        }

        const hasNextPage = (state:FreqDataRowsModelState, sourceId:string):boolean => {
            return parseInt(state.currentPage[sourceId]) < state.data[sourceId].TotalPages;
        }

        const hasPrevPage = (state:FreqDataRowsModelState, sourceId:string):boolean => {
            return parseInt(state.currentPage[sourceId]) > 1 && state.data[sourceId].TotalPages > 1;
        }

        const handleTabSelection = (value:string) => {
            dispatcher.dispatch<typeof Actions.ResultSetActiveTab>({
                name: Actions.ResultSetActiveTab.name,
                payload: {
                    value: value as 'tables'|'charts'
                }
            });
        }

        return (
            <S.FreqResultView>
                <FilterForm minFreqVal={props.flimit} />
                <hr />
                <globalComponents.TabView
                        className="FreqViewSelector"
                        callback={handleTabSelection}
                        items={[
                            {id: 'tables', label: he.translate('freq__tab_tables_button')},
                            {id: 'charts', label: he.translate('freq__tab_charts_button')}
                        ]}
                        defaultId="tables"
                        noButtonSeparator={true} >
                    <div className="FreqResultView">
                        {pipe(
                            props.data,
                            Dict.toEntries(),
                            List.map(([sourceId, block], i) => (
                                <S.FreqBlock key={`block:${sourceId}`}>
                                    <div>
                                    {block ?
                                        <>
                                            <Paginator currentPage={props.currentPage[sourceId]}
                                                    sourceId={sourceId}
                                                    hasNextPage={hasNextPage(props, sourceId)}
                                                    hasPrevPage={hasPrevPage(props, sourceId)}
                                                    totalPages={block.TotalPages}
                                                    isLoading={props.isBusy[sourceId]}
                                                    totalItems={block.Total} />
                                            <div>
                                                <drViews.DataTable head={block.Head}
                                                        sortColumn={props.sortColumn[sourceId]}
                                                        rows={block.Items}
                                                        hasSkippedEmpty={block.SkippedEmpty}
                                                        sourceId={sourceId} />
                                            </div>
                                            {props.saveFormActive ?
                                                <saveViews.SaveFreqForm onClose={handleSaveFormClose} sourceId={sourceId} /> :
                                                null
                                            }
                                        </>
                                        : <FreqResultLoaderView sourceId={sourceId} />
                                    }
                                    </div>
                                </S.FreqBlock>
                                )
                            )
                        )}
                    </div>
                    <div>
                        <chartViews.FreqChartsView />
                    </div>
                </globalComponents.TabView>
            </S.FreqResultView>
        );
    }


    return {
        FreqResultView: BoundWithProps(FreqResultView, freqDataRowsModel)
    };
}