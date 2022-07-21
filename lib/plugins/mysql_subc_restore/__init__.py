# Copyright (c) 2021 Charles University in Prague, Faculty of Arts,
#                    Institute of the Czech National Corpus
# Copyright (c) 2021 Martin Zimandl <martin.zimandl@gmail.com>
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


import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union

import plugins
import ujson as json
from action.model.subcorpus import (CreateSubcorpusArgs,
                                    CreateSubcorpusRawCQLArgs,
                                    CreateSubcorpusWithinArgs)
from plugin_types.corparch import AbstractCorporaArchive
from plugin_types.subc_restore import AbstractSubcRestore, SubcorpusRecord
from plugins import inject
from plugins.errors import PluginCompatibilityException
from plugins.mysql_integration_db import MySqlIntegrationDb


class MySQLSubcRestore(AbstractSubcRestore):
    """
    For the documentation of individual methods, please see AbstractSubcRestore class
    """

    TABLE_NAME = 'kontext_subcorpus'

    def __init__(
            self,
            plugin_conf: Dict[str, Any],
            corparch: AbstractCorporaArchive,
            db: MySqlIntegrationDb):
        self._conf = plugin_conf
        self._corparch = corparch
        self._db = db

    async def create(
            self, ident: str, user_id: int, corpname: str, subcname: str, size: int, public_description, data_path: str,
            data: Union[CreateSubcorpusRawCQLArgs, CreateSubcorpusWithinArgs, CreateSubcorpusArgs]):
        async with self._db.cursor() as cursor:
            if isinstance(data, CreateSubcorpusRawCQLArgs):
                column, value = 'cql', data.cql
            elif isinstance(data, CreateSubcorpusWithinArgs):
                column, value = 'within_cond', json.dumps(data.within)
            elif isinstance(data, CreateSubcorpusArgs):
                column, value = 'text_types', json.dumps(data.text_types)

            await cursor.execute(
                f'INSERT INTO {self.TABLE_NAME} '
                f'(id, user_id, author_id, corpus_name, name, {column}, created, public_description, data_path, size) '
                'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                (ident, user_id, user_id, data.corpname, data.subcname, value, datetime.now(), public_description,
                 data_path, size))
            await cursor.connection.commit()

    async def archive(self, user_id: int, corpname: str, subcname: str):
        async with self._db.cursor() as cursor:
            await cursor.execute(
                f'UPDATE {self.TABLE_NAME} SET archived = NOW() '
                'WHERE user_id = %s AND corpname = %s AND subcname = %s',
                (user_id, corpname, subcname)
            )
        await cursor.connection.commit()

    async def list(self, user_id: int, filter_args: Dict, from_idx: int, to_idx: Optional[int] = None) -> List[SubcorpusRecord]:
        sql = [
            f'SELECT * FROM {self.TABLE_NAME}',
            'WHERE user_id = %s ORDER BY id',
        ]
        args = (user_id,)
        if to_idx is not None:
            sql.append('LIMIT %s, %s')
            args += (from_idx, to_idx - from_idx)
        else:
            sql.append('LIMIT 100000000 OFFSET %s')
            args += (from_idx,)

        async with self._db.cursor() as cursor:
            await cursor.execute(' '.join(sql), args)
            return [SubcorpusRecord(**row) async for row in cursor]

    async def get_info(self, user_id: int, corpname: str, subcname: str) -> Optional[SubcorpusRecord]:
        async with self._db.cursor() as cursor:
            await cursor.execute(
                f'SELECT * FROM {self.TABLE_NAME} '
                'WHERE user_id = %s AND corpname = %s AND subcname = %s '
                'ORDER BY created '
                'LIMIT 1',
                (user_id, corpname, subcname)
            )
            row = await cursor.fetchone()
            return None if row is None else SubcorpusRecord(**row)

    async def get_query(self, query_id: int) -> Optional[SubcorpusRecord]:
        async with self._db.cursor() as cursor:
            await cursor.execute(
                f'SELECT * FROM {self.TABLE_NAME} '
                'WHERE id = %s', (query_id, )
            )
            row = await cursor.fetchone()
            return None if row is None else SubcorpusRecord(**row)


@inject(plugins.runtime.CORPARCH, plugins.runtime.INTEGRATION_DB)
def create_instance(conf, corparch: AbstractCorporaArchive, integ_db: MySqlIntegrationDb):
    plugin_conf = conf.get('plugins', 'subc_restore')
    if integ_db.is_active:
        logging.getLogger(__name__).info(f'mysql_subc_restore uses integration_db[{integ_db.info}]')
        return MySQLSubcRestore(plugin_conf, corparch, integ_db)
    else:
        raise PluginCompatibilityException(
            'mysql_subc_restore works only with integration_db enabled')
