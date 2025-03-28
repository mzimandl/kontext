import { styled } from 'styled-components';
import * as theme from '../../views/theme/default/index.js';

import syntaxTreeIcon from '../../../img/syntax-tree-icon.svg';


export const CorpTreeWidget = styled.div`
    background-color: #FFFFFF;

    ul.corp-tree {
        margin: 0;
        padding: 1em;
        background-color: #FFFFFF;
        position: absolute;
        box-shadow: ${theme.portalBoxShadow};
        list-style-type: none;

        ul {
            list-style-type: none;
            margin: 0;
            padding: 0;
        }

        li {
            padding: 0 0 0 2em;
            margin: 0;
        }

        li.node a {
            text-decoration: none;
            color: ${theme.colorLogoBlue};
        }

        li.node a:hover {
            text-decoration: underline;
        }

        li.leaf a {
            color: ${theme.colorDefaultText};
            text-decoration: none;
        }

        li.leaf a:hover {
            text-decoration: underline;
        }

        img.state-flag {
            padding-right: 0.4em;
        }

        img.lock-sign {
            padding-right: 0.4em;
            width: 1em;
        }
    }
`;

export const CorpTreeComponent = styled.div`
  .tab-nav {
    border-bottom: solid 1px #eeeeee;
    margin-bottom: 10px;
    ul.nav {
      border: 0;
    }
  }

  .lindat-pmltq-logo {
    /* TODO currently no defined solution for custom imgs */
    background: url(${syntaxTreeIcon});
    background-size: 1.7em;
    background-repeat: no-repeat;
    background-position: center;
    padding: 16px 18px;
  }

    .glyphicon-book {
    /* TODO currently no defined solution for custom imgs */
      padding: 0.1em 0.8em;
      font-size: 1em;
      color: #337ab7;
  }

  .ikon-like {
    padding: 6px 0px;
    cursor: default;
    border-radius: 4px;
    vertical-align: middle;
    margin-right: 0.5em;
  }

  .pmltq {
    padding: 6px 0px;
  }

  .corp-tree-sorted {
    border-radius: 0.4em 1.25em 0.4em 1.25em;
    border: 2px solid #00a1db;
    border-top: 28px solid #00a1db;
    padding-left: 0.125em;
    .wrapper-inner-sorted {
      position: relative;
      border-radius: 0em 0em 0.3em 1.25em;
      background-color: #FFF;
      border: 0.06em solid #C0C0C0;
      bottom: -0.06em;
      .leaf {
        position: relative;
        padding: 1em;
        color: #545454;
        border-bottom: 0.1em solid #C0C0C0;
      }
      .tokens {
        padding-top: 0em;
        text-align: right;
        border-right: 0.07em solid #00a1db;
        min-height: 5em;
      }
      .icons {
        padding-top: 1.25em;
        text-align: center;
        border-right: 0.07em solid #00a1db;
        min-height: 5em;
      }
      .tokens > a {
        font-size: 90%;
        color: #e92381;
      }
      .title {
        color: #545454;
        margin-top: 0.7em;
      }
      .desc {
        font-size: 80%;
        color: #343434;
      }
      .actions {
        font-size: 2.6em;
        font-weight: bold;
        .md-transparent {
          /* IE 8 */
          -ms-filter: "progid:DXImageTransform.Microsoft.Alpha(Opacity=50)";
          /* IE 5-7 */
          filter: alpha(opacity=50);
          /* Netscape */
          -moz-opacity: 0.5;
          /* Safari 1.x */
          -khtml-opacity: 0.5;
          /* Good browsers */
          opacity: 0.5;
          &.lock {
            /* IE 8 */
            -ms-filter: "progid:DXImageTransform.Microsoft.Alpha(Opacity=80)";
            /* IE 5-7 */
            filter: alpha(opacity=80);
            /* Netscape */
            -moz-opacity: 0.8;
            /* Safari 1.x */
            -khtml-opacity: 0.8;
            /* Good browsers */
            opacity: 0.8;
          }
        }
      }
      .actions a:hover {
        text-decoration: none;
        -khtml-opacity: 1.0;
        opacity: 1.0;
      }
      .corpus-details {
        margin-bottom: 0.35em;
        padding-left: 1.45em;
      }
      .corpus-details-info {
        color: #e92381;
        margin-right: 0.4em;
      }
      .underline-hover:hover {
        text-decoration: underline;
      }
    }
  }
  .corp-tree {

    .node {
      border-radius: 0.4em 1.25em 0.4em 1.25em;
      background-color: #00a1db;
      padding-left: 0.125em;
      margin-bottom: 1.25em;
      .header {
        font-size: 1.2em;
        padding-left: 1.25em;
        padding-top: 0.125em;
        padding-bottom: 0.125em;
        position: relative;
        color: #FFF;
      }
      .wrapper-inner {
        position: relative;
        border-radius: 0em 0em 0.3em 1.25em;
        background-color: #FFF;
        border: 0.06em solid #C0C0C0;
        bottom: -0.06em;
        .leaf {
          position: relative;
          padding: 1em;
          color: #545454;
          border-bottom: 0.1em solid #C0C0C0;
        }
        .corpora-set-header {
          position: relative;
          padding: 1em;
          color: #545454;
          border-bottom: 1px solid #C0C0C0;
          .subnode {
            font-size: 1.6em;
            .icon {
              font-size: 24px;
              vertical-align: text-top;
            }
          }
          .to-toggle {
            display: none;
            padding-left: 2.85em;
            box-shadow: #00a1db -0.07em 0.07em 0.14em;
          }
        }
        .tokens {
          padding-top: 0em;
          text-align: right;
          border-right: 0.07em solid #00a1db;
          min-height: 5em;
        }
        .icons {
        padding-top: 1.25em;
        text-align: center;
        border-right: 0.07em solid #00a1db;
        min-height: 5em;
        }
        .tokens > a {
          font-size: 90%;
          color: #e92381;
        }
        .title {
          color: #545454;
          margin-top: 0.7em;
        }
        .desc {
          font-size: 80%;
          color: #343434;
        }
        .actions {
          font-size: 2.6em;
          font-weight: bold;
          .md-transparent {
            /* IE 8 */
            -ms-filter: "progid:DXImageTransform.Microsoft.Alpha(Opacity=50)";
            /* IE 5-7 */
            filter: alpha(opacity=50);
            /* Netscape */
            -moz-opacity: 0.5;
            /* Safari 1.x */
            -khtml-opacity: 0.5;
            /* Good browsers */
            opacity: 0.5;
          }
        }
        .actions a:hover {
          text-decoration: none;
          -khtml-opacity: 1.0;
          opacity: 1.0;
        }
        .btn-default:hover {
          box-shadow: 1px 1px 2px #888888;
          background: #d8eff7;
          margin-right: 0.5em;
        }
        .btn-default {
          box-shadow: 1px 1px 2px #cccccc;
          margin-right: 0.5em;
        }
        .corpus-details {
          margin-bottom: 0.35em;
          padding-left: 1.45em;
        }
        .corpus-details-info {
          color: #e92381;
          margin-right: 0.4em;
        }
        .underline-hover:hover {
          text-decoration: underline;
        }
      }
    }
  }
  .glyphicon-lock {
    color: #337ab7;
    font-size: 1em;
    margin: 0.1em 0.8em;
    padding-right: 0.5%;
  }

  .glyphicon-save {
    color: #337ab7;
    font-size: 1em;
    padding-right: 0.5%;
  }

  .glyphicon-save:hover {
    color: #23527c;
  }

  .clickable:hover {
    cursor: pointer;
  }
  .btnlike {
    color: #00a1db;
    margin-top: 10px;
  }
  .search-selected {
    color: #e92381;
  }
`;

export const CorpusMainInfo = styled.div`
  h3 {
    cursor: pointer;
  }
`;