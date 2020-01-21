# Copyright (c) 2013 Charles University in Prague, Faculty of Arts,
#                    Institute of the Czech National Corpus
# Copyright (c) 2013 Tomas Machalek <tomas.machalek@gmail.com>
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

from typing import Dict, Any, Optional, Tuple, TYPE_CHECKING
from werkzeug.contrib.sessions import Session
# this is to fix cyclic imports when running the app caused by typing
if TYPE_CHECKING:
    from controller.plg import PluginApi

import abc
from translation import ugettext as _
from controller.errors import CorpusForbiddenException, UserActionException


class AbstractAuth(abc.ABC):
    """
    Represents general authentication module.
    Custom implementations should inherit from this.
    """

    def __init__(self, anonymous_id: int) -> None:
        """
        arguments:
        anonymous_id -- a numeric ID of anonymous user
        """
        self._anonymous_id = anonymous_id

    def anonymous_user(self) -> Dict[str, Any]:
        """
        Returns a dictionary containing (key, value) pairs
        specifying anonymous user. By default it is ID = 0,
        user = 'anonymous', fullname = _('anonymous')
        """
        return dict(
            id=self._anonymous_id,
            user='anonymous',
            fullname=_('anonymous'))

    def is_anonymous(self, user_id: int) -> bool:
        return user_id == self._anonymous_id

    def is_administrator(self, user_id: int) -> bool:
        """
        Should return True if user has administrator's privileges
        else False

        arguments:
        user_id -- user's database ID
        """
        return False

    @abc.abstractmethod
    def permitted_corpora(self, user_dict: Dict[str, Any]) -> Dict[str, str]:
        """
        Return a dictionary containing corpora IDs user can access.

        arguments:
        user_dict -- user credentials as returned by validate_user()
                     (or as written to session by revalidate() in case
                     of AbstractRemoteAuth implementations).

        returns:
        a dict corpus_id=>corpus_variant
        """

    def on_forbidden_corpus(self, plugin_api: 'PluginApi', corpname: str, corp_variant: str):
        """
        Optional method run in case KonText finds out that user
        does not have access rights to a corpus specified by 'corpname'.
        There are two main action types you can perform here:
        1) Redirect to a different page or set 'not found'.
        2) Set some system message user can read.
        """
        if corpname:
            raise CorpusForbiddenException(corpname, corp_variant)
        else:
            # normally, this happens only with flawed configuration
            # (e.g. no default accessible corpus for the current user)
            raise UserActionException('Cannot find any usable corpus for the user.')

    @abc.abstractmethod
    def get_user_info(self, plugin_api: 'PluginApi') -> Dict[str, Any]:
        """
        Return a dictionary containing all the data about a user.
        Sensitive information like password hashes, recovery questions
        etc. are not expected/required to be included.
        """

    def logout_hook(self, plugin_api: 'PluginApi'):
        """
        An action performed after logout process finishes
        """
        pass


class AbstractSemiInternalAuth(AbstractAuth):

    @abc.abstractmethod
    def validate_user(self, plugin_api: 'PluginApi', username: str, password: str) -> Dict[str, Any]:
        """
        Tries to find a user with matching 'username' and 'password'.
        If a match is found then proper credentials of the user are
        returned. Otherwise an anonymous user's credentials should be
        returned.

        arguments:
        plugin_api -- a kontext.PluginApi instance
        username -- login username
        password -- login password

        returns:
        a dict {'id': ..., 'user': ..., 'fullname'} where 'user' means
        actually 'username'.
        """


class AbstractInternalAuth(AbstractSemiInternalAuth):
    """
    A general authentication running within KonText.
    """

    @abc.abstractmethod
    def get_login_url(self, return_url: Optional[str] = None) -> str:
        """
        Specifies where should KonText redirect a user in case
        he wants to log in. In general, it can be KonText's URL
        or a URL of some other authentication application.
        """

    @abc.abstractmethod
    def get_logout_url(self, return_url: Optional[str] = None) -> str:
        """
        Specifies where should KonText redirect a user in case
        he wants to log out. In general, it can be KonText's URL
        or a URL of some other authentication application.
        """

    @abc.abstractmethod
    def update_user_password(self, user_id: int, password: str):
        """
        Changes a password of provided user.
        """

    @abc.abstractmethod
    def logout(self, session: Session):
        """
        Logs-out current user (identified by passed session object).
        """

    @abc.abstractmethod
    def get_required_password_properties(self) -> str:
        """
        Returns a text description of required password
        properties (e.g.: "at least 5 characters long, at least one digit)
        This should be consistent with validate_new_password().
        """

    @abc.abstractmethod
    def validate_new_password(self, password: str) -> bool:
        """
        Tests whether the provided password matches all the
        required properties. This should be consistent with
        get_required_password_properties().
        """

    @abc.abstractmethod
    def get_required_username_properties(self, plugin_api: 'PluginApi') -> str:
        pass

    @abc.abstractmethod
    def validate_new_username(self, plugin_api: 'PluginApi', username: str) -> Tuple[bool, bool]:
        """
        returns:
            a 2-tuple (availability, validity) (both bool)
        """

    @abc.abstractmethod
    def sign_up_user(self, plugin_api: 'PluginApi', credentials: Dict[str, Any]):
        pass

    @abc.abstractmethod
    def sign_up_confirm(self, plugin_api: 'PluginApi', key: str) -> bool:
        pass

    @abc.abstractmethod
    def get_form_props_from_token(self, key: str) -> Dict[str, Any]:
        pass


class AbstractRemoteAuth(AbstractAuth):
    """
    A general authentication based on an external authentication service.
    """

    @abc.abstractmethod
    def revalidate(self, plugin_api: 'PluginApi'):
        """
        Re-validates user authentication against external database with central
        authentication ticket (stored as a cookie) and session data.
        Resulting user data are written to the session (typically - if a remote
        service marks auth. cookie as invalid we store an anonymous user into
        the session. The method returns no value.

        Please note that in case this method raises an exception, KonText
        automatically sets current user as 'anonymous' to prevent security issues.

        The method is expected to write a proper user credentials dict to
        the session. Please see AbstractSemiInternalAuth.validate_user for details.

        arguments:
        plugin_api -- a controller.PluginApi instance
        """


class AuthException(Exception):
    """
    General authentication/authorization exception
    """
    pass


class SignUpNeedsUpdateException(AuthException):
    pass
