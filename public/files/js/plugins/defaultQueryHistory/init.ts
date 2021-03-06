import { IModel } from 'kombo';
/*
 * Copyright (c) 2014 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2014 Tomas Machalek <tomas.machalek@gmail.com>
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

import { PluginInterfaces, IPluginApi } from '../../types/plugins';
import { QueryHistoryModel } from './models';
import { init as viewsInit } from './view';

declare var require:any;
require('./style.less'); // webpack

export class QueryHistoryPlugin implements PluginInterfaces.QueryHistory.IPlugin {

    private pluginApi:IPluginApi;

    private model:QueryHistoryModel;

    constructor(pluginApi:IPluginApi, model:QueryHistoryModel) {
        this.pluginApi = pluginApi;
        this.model = model;
    }

    isActive():boolean {
        return true;
    }

    getWidgetView():PluginInterfaces.QueryHistory.WidgetView {
        return viewsInit(
            this.pluginApi.dispatcher(),
            this.pluginApi.getComponentHelpers(),
            this.model
        ).QueryHistory;
    }

    getModel():IModel<PluginInterfaces.QueryHistory.ModelState> {
        return this.model;
    }

}

const create:PluginInterfaces.QueryHistory.Factory = (pluginApi, offset, limit, pageSize) => {
    return new QueryHistoryPlugin(pluginApi, new QueryHistoryModel(pluginApi, offset, limit, pageSize));
};

export default create;
