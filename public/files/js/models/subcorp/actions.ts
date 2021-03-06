/*
 * Copyright (c) 2020 Charles University in Prague, Faculty of Arts,
 *                    Institute of the Czech National Corpus
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

import { Action } from 'kombo';
import { SubcListFilter } from './list';
import { InputMode } from './common';
import { TextTypes } from '../../types/common';
import { LoadDataResponse } from './listPublic';


export enum ActionName {

    SortLines = 'SUBCORP_LIST_SORT_LINES',
    DeleteSubcorpus = 'SUBCORP_LIST_DELETE_SUBCORPUS',
    UpdateFilter = 'SUBCORP_LIST_UPDATE_FILTER',
    ShowActionWindow = 'SUBCORP_LIST_SHOW_ACTION_WINDOW',
    HideActionWindow = 'SUBCORP_LIST_HIDE_ACTION_WINDOW',
    SetActionBoxType = 'SUBCORP_LIST_SET_ACTION_BOX_TYPE',
    WipeSubcorpus = 'SUBCORP_LIST_WIPE_SUBCORPUS',
    RestoreSubcorpus = 'SUBCORP_LIST_RESTORE_SUBCORPUS',
    ReuseQuery = 'SUBCORP_LIST_REUSE_QUERY',
    PublishSubcorpus = 'SUBCORP_LIST_PUBLISH_SUBCORPUS',
    UpdatePublicDescription = 'SUBCORP_LIST_UPDATE_PUBLIC_DESCRIPTION',
    SubmitPublicDescription = 'SUBCORP_LIST_PUBLIC_DESCRIPTION_SUBMIT',
    PublishItem = 'SUBCORP_LIST_PUBLISH_ITEM',
    FormSetInputMode = 'SUBCORP_FORM_SET_INPUT_MODE',
    FormSetSubcName = 'SUBCORP_FORM_SET_SUBCNAME',
    FormSetSubcAsPublic = 'SUBCORP_FORM_SET_SUBC_AS_PUBLIC',
    FormSetDescription = 'SUBCORP_FORM_SET_DESCRIPTION',
    FormSubmit = 'SUBCORP_FORM_SUBMIT',
    FormSetAlignedCorpora = 'SUBCORP_FORM_SET_ALIGNED_CORPORA',
    SetSearchQuery = 'PUBSUBC_SET_SEARCH_QUERY',
    SubmitSearchQuery = 'PUBSUBC_SUBMIT_SEARCH_QUERY',
    DataLoadDone = 'PUBSUBC_DATA_LOAD_DONE',
    UseInQuery = 'PUBSUBC_USE_IN_QUERY',
    FormWithinLineAdded = 'SUBCORP_FORM_WITHIN_LINE_ADDED',
    FormWithinLineSetType = 'SUBCORP_FORM_WITHIN_LINE_SET_WITHIN_TYPE',
    FormWithinLineSetStruct = 'SUBCORP_FORM_WITHIN_LINE_SET_STRUCT',
    FormWithinLineSetCQL = 'SUBCORP_FORM_WITHIN_LINE_SET_CQL',
    FormWithinLineRemoved = 'SUBCORP_FORM_WITHIN_LINE_REMOVED',
    FormShowRawWithinHint = 'SUBCORP_FORM_SHOW_RAW_WITHIN_HINT',
    FormHideRawWithinHint = 'SUBCORP_FORM_HIDE_RAW_WITHIN_HINT',

}

export namespace Actions {

    export interface SortLines extends Action<{
        colName:string;
        reverse:boolean;
    }> {
        name:ActionName.SortLines
    }

    export interface DeleteSubcorpus extends Action<{
        rowIdx:number;
    }> {
        name:ActionName.DeleteSubcorpus
    }

    export interface UpdateFilter extends Action<SubcListFilter> {
        name:ActionName.UpdateFilter
    }

    export interface ShowActionWindow extends Action<{
        value:number;
        action:string;
    }> {
        name:ActionName.ShowActionWindow
    }

    export interface HideActionWindow extends Action<{
    }> {
        name:ActionName.HideActionWindow
    }

    export interface SetActionBoxType extends Action<{
        value:string;
        row:number;
    }> {
        name:ActionName.SetActionBoxType
    }

    export interface WipeSubcorpus extends Action<{
        idx:number;
    }> {
        name:ActionName.WipeSubcorpus
    }

    export interface RestoreSubcorpus extends Action<{
        idx:number;
    }> {
        name:ActionName.RestoreSubcorpus
    }

    export interface ReuseQuery extends Action<{
        idx:number;
        newName:string;
        newCql:string;
    }> {
        name:ActionName.ReuseQuery;
    }

    export interface PublishSubcorpus extends Action<{
        rowIdx:number;
        description:string;
    }> {
        name:ActionName.PublishSubcorpus;
    }

    export interface UpdatePublicDescription extends Action<{
        rowIdx:number;
        description:string;
    }> {
        name:ActionName.UpdatePublicDescription;
    }

    export interface SubmitPublicDescription extends Action<{
        rowIdx:number;
    }> {
        name:ActionName.SubmitPublicDescription;
    }

    export interface PublishItem extends Action<{
        corpname:string;
        subcname:string;
    }> {
        name:ActionName.PublishItem;
    }

    export interface FormSetSubcName extends Action<{
        value:string;
    }> {
        name:ActionName.FormSetSubcName;
    }

    export interface FormSetInputMode extends Action<{
        value:InputMode;
    }> {
        name:ActionName.FormSetInputMode;
    }

    export interface FormSetSubcAsPublic extends Action<{
        value:boolean;
    }> {
        name:ActionName.FormSetSubcAsPublic;
    }

    export interface FormSetDescription extends Action<{
        value:string;
    }> {
        name:ActionName.FormSetDescription;
    }

    export interface FormSubmit extends Action<{
    }> {
        name:ActionName.FormSubmit;
    }

    export interface FormSetAlignedCorpora extends Action<{
        alignedCorpora:Array<TextTypes.AlignedLanguageItem>;
    }> {
        name:ActionName.FormSetAlignedCorpora;
    }

    export interface SetSearchQuery extends Action<{
        value:string;
    }> {
        name:ActionName.SetSearchQuery;
    }

    export interface SubmitSearchQuery extends Action<{
        query:string;
    }> {
        name:ActionName.SubmitSearchQuery;
    }

    export interface DataLoadDone extends Action<{
        data:LoadDataResponse;
    }> {
        name:ActionName.DataLoadDone;
    }

    export interface UseInQuery extends Action<{
        corpname:string;
        id:string;
    }> {
        name:ActionName.UseInQuery;
    }

    export interface FormWithinLineAdded extends Action<{
        structureName:string;
        negated:boolean;
        attributeCql:string;
    }> {
        name:ActionName.FormWithinLineAdded;
    }

    export interface FormWithinLineSetType extends Action<{
        rowIdx:number;
        value:boolean;
    }> {
        name:ActionName.FormWithinLineSetType;
    }

    export interface FormWithinLineSetStruct extends Action<{
        rowIdx:number;
        value:string;
    }> {
        name:ActionName.FormWithinLineSetStruct;
    }

    export interface FormWithinLineSetCQL extends Action<{
        rowIdx:number;
        value:string;
    }> {
        name:ActionName.FormWithinLineSetCQL;
    }

    export interface FormWithinLineRemoved extends Action<{
        rowIdx:number;
    }> {
        name:ActionName.FormWithinLineRemoved;
    }

    export interface FormShowRawWithinHint extends Action<{
    }> {
        name:ActionName.FormShowRawWithinHint;
    }

    export interface FormHideRawWithinHint extends Action<{
    }> {
        name:ActionName.FormHideRawWithinHint;
    }
}