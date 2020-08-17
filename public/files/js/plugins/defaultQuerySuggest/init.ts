/*
 * Copyright (c) 2020 Charles University, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2020 Tomas Machalek <tomas.machalek@gmail.com>
 * Copyright (c) 2020 Martin Zimandl <martin.zimandl@gmail.com>
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

import { List, pipe, Dict } from 'cnc-tskit';

import { PluginInterfaces, IPluginApi } from '../../types/plugins';
import { init as initView, SuggestionsViews, KnownRenderers } from './view';
import { Model } from './model';
import { QueryType } from '../../models/query/common';


declare var require:any;
require('./style.less');

type SupportedQueryTypes = {[frontendId:string]:Array<QueryType>};

/**
 *
 */
export class DefaultQuerySuggest implements PluginInterfaces.QuerySuggest.IPlugin {

    protected readonly pluginApi:IPluginApi;

    protected readonly views:SuggestionsViews;

    protected readonly providers:Array<{frontendId:string; queryTypes:Array<QueryType>}>;

    protected readonly model:Model;

    constructor(
        pluginApi:IPluginApi,
        views:SuggestionsViews,
        model:Model,
        suppQueryTypes:SupportedQueryTypes
    ) {
        this.pluginApi = pluginApi;
        this.views = views;
        this.model = model;
        this.providers = pipe(
            suppQueryTypes,
            Dict.toEntries(),
            List.map(
                ([frontendId, queryTypes]) => ({
                    frontendId,
                    queryTypes
                })
            )
        );
        console.log('supported query types: ', this.providers);
    }

    isActive():boolean {
        return true;
    }

    supportsQueryType(qtype:QueryType):boolean {
        return List.some(
            v => List.some(
                qt => qt === qtype,
                v.queryTypes
            ),
            this.providers
        );
    }

    createComponent(rendererId:string, data:unknown):[
        React.ComponentClass<{data:unknown|string|Error|Array<string>}>|
        React.SFC<{data:unknown|string|Error|Array<string>}>,
        unknown|string|Error|Array<string>
    ] {
        switch (rendererId) {
            case KnownRenderers.ERROR:
                if (this.errorTypeGuard(data)) {
                    return [this.views.error, data];
                }
            break;
            case KnownRenderers.BASIC:
                if (this.basicTypeGuard(data)) {
                    return [this.views.basic, data];
                }
            break;
            default:
                return [this.views.unsupported, data];
        }
        return [this.views.error, `Invalid data for the ${rendererId} frontend`];
    }

    errorTypeGuard(data:unknown):data is Error {
        return data instanceof Error || typeof data === 'string';
    }

    basicTypeGuard(data:unknown):data is Array<string> {
        return data instanceof Array && List.every(v => typeof v === 'string', data);
    }

}


const create:PluginInterfaces.QuerySuggest.Factory = (pluginApi) => {
    const model = new Model(
        pluginApi.dispatcher(),
        {
            corpora: List.concat(
                pluginApi.getConf('alignedCorpora'),
                [pluginApi.getCorpusIdent().id]
            ),
            subcorpus: pluginApi.getCorpusIdent().usesubcorp,
            isBusy: false,
            answers: {},
            currQueryHash: ''
        },
        pluginApi
    );
    return new DefaultQuerySuggest(
        pluginApi,
        initView(pluginApi.dispatcher(), model, pluginApi.getComponentHelpers()),
        model,
        pluginApi.getNestedConf<SupportedQueryTypes>('pluginData', 'query_suggest', 'query_types')
    );
};

export default create;
