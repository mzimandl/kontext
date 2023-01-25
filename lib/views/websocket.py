# Copyright (c) 2023 Charles University, Faculty of Arts,
#                    Institute of the Czech National Corpus
# Copyright (c) 2023 Martin Zimandl <martin.zimandl@gmail.com>
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

import asyncio

import settings
import ujson as json
from action.krequest import KRequest
from action.model import ModelsSharedData
from action.model.user import UserActionModel
from action.props import ActionProps
from sanic import Blueprint, Request, Sanic, Websocket
from views.root import _check_tasks_status

bp = Blueprint('websocket', 'ws')


async def _init_user_action_model(request: Request) -> UserActionModel:
    application = Sanic.get_app('kontext')
    app_url_prefix = application.config['action_path_prefix']
    req = KRequest(request, app_url_prefix, None)

    if request.path.startswith(app_url_prefix):
        norm_path = request.path[len(app_url_prefix):]
    else:
        norm_path = request.path
    path_elms = norm_path.split('/')
    action_name = path_elms[-1]
    action_prefix = '/'.join(path_elms[:-1]) if len(path_elms) > 1 else ''
    runtime_access_level = 2 if settings.get_bool('global', 'no_anonymous_access', False) else 1
    aprops = ActionProps(
        action_name=action_name, action_prefix=action_prefix,
        access_level=runtime_access_level,
        return_type='plain',  # TODO
        mutates_result=False, action_log_mapper=None)

    shared_data = ModelsSharedData(application.ctx.tt_cache, dict())
    amodel = UserActionModel(req, None, aprops, shared_data)
    await amodel.init_session()
    if amodel.user_is_anonymous():
        raise PermissionError
    return amodel


@bp.websocket('/check_tasks_status')
async def check_tasks_status(request: Request, ws: Websocket):
    try:
        amodel = await _init_user_action_model(request)

    except PermissionError:
        await ws.send('Access forbidden - please log-in.')
        return

    tasks = await _check_tasks_status(amodel, request, None)
    await ws.send(json.dumps(tasks))
    while True:
        await asyncio.sleep(1)
        new_tasks = await _check_tasks_status(amodel, request, None)
        await ws.send(json.dumps(new_tasks))
