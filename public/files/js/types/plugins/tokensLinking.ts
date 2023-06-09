/*
 * Copyright (c) 2023 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
 * Copyright (c) 2023 Martin Zimandl <martin.zimandl@gmail.com>
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

import { Action } from 'kombo';
import { BasePlugin, IPluginApi } from './common';

// ------------------------------------------------------------------------
// ------------------------- [tokens_linking] plug-in -----------------------

export interface IPlugin extends BasePlugin {
}

export type AttrSet = {
    [attr:string]:string|number;
};

export class Actions {

    static FetchInfo:Action<{
        corpusId:string;
        tokenId:number;
        tokenLength:number;
        tokenRanges:{[corpusId:string]:[number, number]};
    }> = {
        name: 'TOKENS_LINKING_FETCH_INFO'
    };

    static FetchInfoDone:Action<{
        data:unknown;
    }> = {
        name: 'TOKENS_LINKING_FETCH_INFO_DONE'
    }
}

export type Factory = (
    pluginApi:IPluginApi,
)=>IPlugin;