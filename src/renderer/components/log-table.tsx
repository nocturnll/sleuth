import { SleuthState } from '../state/sleuth';
import * as React from 'react';
import * as classNames from 'classnames';
import * as moment from 'moment';
import { Table, Column, Cell } from 'fixed-data-table-2';
import * as FDT from '@types/fixed-data-table';
import { AutoSizer } from 'react-virtualized';

import { LevelFilter, LogEntry, MergedLogFile, ProcessedLogFile } from '../interfaces';
import { didFilterChange } from '../../utils/did-filter-change';
import { Alert } from './alert';
import { LogTableHeaderCell } from './log-table-headercell';

const debug = require('debug')('sleuth:logtable');

export const SORT_TYPES = {
  ASC: 'ASC',
  DESC: 'DESC',
};

export interface RowClickEvent {
  index: number;
  rowData: any;
}

export interface LogTableProps {
  logFile: ProcessedLogFile | MergedLogFile;
  levelFilter: LevelFilter;
  search?: string;
  dateTimeFormat: string;
  state: SleuthState;
  showOnlySearchResults: boolean;
  searchIndex: number;
}

export interface LogTableState {
  sortedList: Array<LogEntry>;
  searchList: Array<number>;
  selectedEntry?: LogEntry;
  selectedIndex?: number;
  sortBy?: string;
  sortDirection?: string;
  ignoreSearchIndex: boolean;
}

export interface SortFilterListOptions {
  sortBy?: string;
  sortDirection?: string;
  filter?: LevelFilter;
  search?: string;
  logFile?: ProcessedLogFile | MergedLogFile;
  showOnlySearchResults?: boolean;
}

export class LogTable extends React.Component<LogTableProps, Partial<LogTableState>> {
  private tableElement: FDT.Table;
  private readonly refHandlers = {
    table: (ref: FDT.Table) => this.tableElement = ref,
  };

  constructor(props: LogTableProps) {
    super(props);

    this.state = {
      sortedList: [],
      sortBy: 'index',
      sortDirection: 'ASC',
      searchList: [],
      ignoreSearchIndex: false
    };

    this.onRowClick = this.onRowClick.bind(this);
    this.renderTable = this.renderTable.bind(this);
    this.messageCellRenderer = this.messageCellRenderer.bind(this);
    this.timestampCellRenderer = this.timestampCellRenderer.bind(this);
    this.sortFilterList = this.sortFilterList.bind(this);
    this.onSortChange = this.onSortChange.bind(this);
    this.rowClassNameGetter = this.rowClassNameGetter.bind(this);
  }

  /**
   * Attempts at being smart about updates
   *
   * @param {LogTableProps} nextProps
   * @param {LogTableState} nextState
   * @returns {boolean}
   */
  public shouldComponentUpdate(nextProps: LogTableProps, nextState: LogTableState): boolean {
    const { dateTimeFormat, levelFilter, logFile, searchIndex } = this.props;
    const { sortBy, sortDirection, sortedList, searchList, selectedIndex } = this.state;
    const nextFile = nextProps.logFile;
    const newSort = (nextState.sortBy !== sortBy || nextState.sortDirection !== sortDirection);

    // Selected row changed
    if (selectedIndex !== nextState.selectedIndex) return true;

    // DateTimeFormat changed
    if (dateTimeFormat !== nextProps.dateTimeFormat) return true;

    // Sort direction changed
    if (newSort) return true;

    // File changed - and update is in order
    const newFile = ((!nextFile && logFile)
      || nextFile && logFile && nextFile.logType !== logFile.logType);
    const newEntries = (nextFile && logFile
      && nextFile.logEntries.length !== logFile.logEntries.length);
    const newResults = ((!sortedList && nextState.sortedList)
      || sortedList && nextState.sortedList.length !== sortedList.length);
    if (newFile || newEntries || newResults) return true;

    // Filter changed
    if (didFilterChange(levelFilter, nextProps.levelFilter)) return true;

    // Search changed
    if (searchList !== nextState.searchList || searchIndex !== nextProps.searchIndex) return true;

    return false;
  }

  /**
   * React's componentWillReceiveProps
   *
   * @param {LogTableProps} nextProps
   */
  public componentWillReceiveProps(nextProps: LogTableProps): void {
    const { levelFilter, search, logFile, showOnlySearchResults, searchIndex } = this.props;
    const searchChanged = search !== nextProps.search || showOnlySearchResults !== nextProps.showOnlySearchResults;
    const nextFile = nextProps.logFile;
    const fileChanged = ((!logFile && nextFile)
      || logFile && nextFile && logFile.logEntries.length !== nextFile.logEntries.length
      || logFile && nextFile && logFile.logType !== nextFile.logType);

    // Filter or search changed
    const nextLevelFilter = nextProps.levelFilter;
    const filterChanged = didFilterChange(levelFilter, nextLevelFilter);
    const nextSearch = nextProps.search;

    if (filterChanged || searchChanged || fileChanged) {
      const sortOptions: SortFilterListOptions = {
        showOnlySearchResults: nextProps.showOnlySearchResults,
        filter: nextLevelFilter,
        search: nextSearch,
        logFile: nextFile
      };
      const sortedList = this.sortFilterList(sortOptions);
      let searchList: Array<number> = [];

      // Should we create a search list?
      if (!nextProps.showOnlySearchResults && nextSearch) {
        debug(`showOnlySearchResults is false, making search list`);
        searchList = this.doSearchIndex(nextSearch, sortedList);
      }

      this.setState({ sortedList, searchList });
    }

    if (searchIndex !== nextProps.searchIndex) {
      this.setState({ ignoreSearchIndex: false })
    }
  }

  /**
   * React's componentDidMount
   */
  public componentDidMount() {
    this.setState({ sortedList: this.sortFilterList() });
  }

  /**
   * Handles a single click onto a row
   *
   * @param {RowClickEvent} { index }
   */
  public onRowClick(_e: any, index: number) {
    const selectedEntry = this.state.sortedList![index] || null;

    this.props.state.selectedEntry = selectedEntry;
    this.props.state.isDetailsVisible = true;
    this.setState({ selectedIndex: index, ignoreSearchIndex: true });
  }

  /**
   * Handles the change of sorting direction. This method is passed to the LogTableHeaderCell
   * components, who call it once the user changes sorting.
   *
   * @param {string} sortBy
   * @param {string} sortDirection
   */
  public onSortChange(sortBy: string, sortDirection: string) {
    const currentState = this.state;
    const newSort = (currentState.sortBy !== sortBy || currentState.sortDirection !== sortDirection);

    if (newSort) {
      this.setState({ sortBy, sortDirection, sortedList: this.sortFilterList({ sortBy, sortDirection }) });
    }
  }

  /**
   * Checks whether or not the table should filter
   *
   * @returns {boolean}
   */
  public shouldFilter(filter?: LevelFilter): boolean {
    filter = filter || this.props.levelFilter;

    if (!filter) return false;
    const allEnabled = Object.keys(filter).every((k) => filter![k]);
    const allDisabled = Object.keys(filter).every((k) => !filter![k]);

    return !(allEnabled || allDisabled);
  }

  /**
   * Performs a search operation
   *
   * @param {string} search
   * @param {Array<LogEntry>} list
   * @returns Array<LogEntry>
   */
  public doSearchFilter(search: string, list: Array<LogEntry>): Array<LogEntry> {
    let searchRegex = new RegExp(search || '', 'i');

    function doSearch(a: LogEntry) { return (!search || searchRegex.test(a.message)); };
    function doExclude(a: LogEntry) { return (!search || !searchRegex.test(a.message)); };
    const searchParams = search.split(' ');

    searchParams.forEach((param) => {
      if (param.startsWith('!') && param.length > 1) {
        debug(`Filter-Excluding ${param.slice(1)}`);
        searchRegex = new RegExp(param.slice(1) || '', 'i');
        list = list.filter(doExclude);
      } else {
        debug(`Filter-Searching for ${param}`);
        list = list.filter(doSearch);
      }
    });

    return list;
  }

  /**
   * Performs a search operation
   *
   * @param {string} search
   * @param {Array<LogEntry>} list
   * @returns Array<number>
   */
  public doSearchIndex(search: string, list: Array<LogEntry>): Array<number> {
    let searchRegex = new RegExp(search || '', 'i');
    const foundIndices: Array<number> = [];

    function doSearch(a: LogEntry, i: number) {
      if (!search || searchRegex.test(a.message)) foundIndices.push(i);
    };

    function doExclude(a: LogEntry, i: number) {
      if (!search || !searchRegex.test(a.message)) foundIndices.push(i);
    };
    const searchParams = search.split(' ');

    searchParams.forEach((param) => {
      if (param.startsWith('!') && param.length > 1) {
        debug(`Index-Excluding ${param.slice(1)}`);
        searchRegex = new RegExp(param.slice(1) || '', 'i');
        list.forEach(doExclude);
      } else {
        debug(`Index-Searching for ${param}`);
        list.forEach(doSearch);
      }
    });

    return foundIndices;
  }

  /**
   * Sorts the list
   */
  public sortFilterList(options: SortFilterListOptions = {}): Array<LogEntry> {
    const logFile = options.logFile || this.props.logFile;
    const filter = options.filter || this.props.levelFilter;
    const search = options.search !== undefined ? options.search : this.props.search;
    const sortBy = options.sortBy || this.state.sortBy;
    const showOnlySearchResults = options.showOnlySearchResults !== undefined ? options.showOnlySearchResults : this.props.showOnlySearchResults;
    const sortDirection = options.sortDirection || this.state.sortDirection;

    debug(`Starting filter`);
    if (!logFile) return [];

    const shouldFilter = this.shouldFilter(filter);
    const noSort = (!sortBy || sortBy === 'index') && (!sortDirection || sortDirection === SORT_TYPES.ASC);

    // Check if we can bail early and just use the naked logEntries array
    if (noSort && !shouldFilter && !search) return logFile.logEntries;

    let sortedList = logFile.logEntries!.concat();

    // Named definition here allows V8 to go craaaaaazy, speed-wise.
    function doSortByMessage(a: LogEntry, b: LogEntry) { return a.message.localeCompare(b.message); };
    function doSortByLevel(a: LogEntry, b: LogEntry) { return a.level.localeCompare(b.level); };
    function doFilter(a: LogEntry) { return (a.level && filter![a.level]); };

    // Filter
    if (shouldFilter) {
      sortedList = sortedList.filter(doFilter);
    }

    // Search
    if (search && showOnlySearchResults) {
      sortedList = this.doSearchFilter(search, sortedList);
    }

    // Sort
    if (sortBy === 'index' || sortBy === 'timestamp') {
      debug(`Sorting by ${sortBy} (aka doing nothing)`);
    } else if (sortBy === 'message') {
      debug('Sorting by message');
      sortedList = sortedList.sort(doSortByMessage);
    } else if (sortBy === 'level') {
      debug('Sorting by level');
      sortedList = sortedList.sort(doSortByLevel);
    }

    if (sortDirection === SORT_TYPES.DESC) {
      debug('Reversing');
      sortedList.reverse();
    }

    return sortedList;
  }

  /**
   * Checks if we're looking at a web app log and returns a warning, so that users know
   * the app didn't all over
   *
   * @returns {(JSX.Element | null)}
   */
  public renderWebAppWarning(): JSX.Element | null {
    const { logFile } = this.props;

    const text = `The web app logs are difficult to parse for a computer - proceed with caution. Combined view is disabled.`;
    return logFile.logType === 'webapp' ? <Alert text={text} level='warning' /> : null;
  }

  /**
   * Renders the "message" cell
   *
   * @param {any} { cellData, columnData, dataKey, rowData, rowIndex }
   * @returns {(JSX.Element | string)}
   */
  public messageCellRenderer(entry: LogEntry): JSX.Element | string {
    if (entry && entry.meta) {
      return (<span title={entry.message}><i className='ts_icon ts_icon_all_files_alt HasData'/> {entry.message}</span>);
    } else if (entry && entry.repeated) {
      return `(Repeated ${entry.repeated.length} times) ${entry.message}`;
    } else {
      return entry.message;
    }
  }

  /**
   * Renders a cell, prefixing the log entries type.
   *
   * @param {any} { cellData, columnData, dataKey, rowData, rowIndex }
   * @returns {JSX.Element}
   */
  public timestampCellRenderer(entry: LogEntry): JSX.Element | String {
    // Todo: This could be cool, but it's expensive af
    const { dateTimeFormat } = this.props;
    const timestamp = entry.momentValue ? moment(entry.momentValue).format(dateTimeFormat) : entry.timestamp;
    let prefix = <i className='Meta ts_icon ts_icon_question'/>;

    if (entry.logType === 'browser') {
      prefix = <i title='Browser Log' className='Meta Color-Browser ts_icon ts_icon_power_off'/>;
    } else if (entry.logType === 'renderer') {
      prefix = <i title='Renderer Log' className='Meta Color-Renderer ts_icon ts_icon_laptop'/>;
    } else if (entry.logType === 'webapp') {
      prefix = <i title='Webapp Log' className='Meta Color-Webapp ts_icon ts_icon_globe'/>;
    } else if (entry.logType === 'webview') {
      prefix = <i title='Webview Log' className='Meta Color-Webview ts_icon ts_icon_all_files_alt'/>;
    } else if (entry.logType === 'call') {
      prefix = <i title='Call Log' className='Meta Color-Call ts_icon ts_icon_phone'/>;
    }

    return (<span title={entry.timestamp}>{prefix}{timestamp}</span>);
  }

  /**
   * Renders the table
   *
   * @param {*} options
   * @param {Array<LogEntry>} sortedList
   * @returns {JSX.Element}
   */
  public renderTable(options: any): JSX.Element {
    const { sortedList, sortDirection, sortBy, searchList, ignoreSearchIndex } = this.state;
    const { searchIndex } = this.props;
    const self = this;
    const timestampHeaderOptions = { sortKey: 'timestamp', onSortChange: this.onSortChange, sortDirection, sortBy };
    const timestampHeader = <LogTableHeaderCell {...timestampHeaderOptions}>Timestamp</LogTableHeaderCell>;
    const indexHeaderOptions = { sortKey: 'index', onSortChange: this.onSortChange, sortDirection, sortBy };
    const indexHeader = <LogTableHeaderCell {...indexHeaderOptions}>#</LogTableHeaderCell>;
    const levelHeaderOptions = { sortKey: 'level', onSortChange: this.onSortChange, sortDirection, sortBy };
    const levelHeader = <LogTableHeaderCell {...levelHeaderOptions}>Level</LogTableHeaderCell>;
    const messageHeaderOptions = { sortKey: 'message', onSortChange: this.onSortChange, sortDirection, sortBy };
    const messageHeader = <LogTableHeaderCell {...messageHeaderOptions}>Message</LogTableHeaderCell>;

    const tableOptions = {
      ...options,
      rowHeight: 30,
      rowsCount: sortedList!.length,
      onRowClick: this.onRowClick,
      rowClassNameGetter: this.rowClassNameGetter,
      ref: this.refHandlers.table,
      headerHeight: 30
    };

    if (!ignoreSearchIndex) tableOptions.scrollToRow = searchList![searchIndex] || 0;

    function renderIndex(props: any) {
      return <Cell {...props}>{sortedList![props.rowIndex].index}</Cell>;
    }
    function renderTimestamp(props: any) {
      return <Cell {...props}>{self.timestampCellRenderer(sortedList![props.rowIndex])}</Cell>;
    }
    function renderMessageCell(props: any) {
      return <Cell {...props}>{self.messageCellRenderer(sortedList![props.rowIndex])}</Cell>;
    }
    function renderLevel(props: any) {
      return <Cell {...props}>{sortedList![props.rowIndex].level}</Cell>;
    }

    return (
      <Table {...tableOptions}>
        <Column header={indexHeader} cell={renderIndex} width={100}  />
        <Column header={timestampHeader} cell={renderTimestamp} width={220}  />
        <Column header={levelHeader} cell={renderLevel} width={70}  />
        <Column header={messageHeader} flexGrow={1} cell={renderMessageCell} width={300} />
      </Table>);
  }

  public render(): JSX.Element | null {
    const { logFile } = this.props;

    const typeClassName = logFile.type === 'MergedLogFile' ? 'Merged' : 'Single';
    const className = classNames('LogTable', typeClassName);
    const warning = this.renderWebAppWarning();

    return (
      <div className={className}>
        {warning}
        <div className={classNames('Sizer', { HasWarning: !!warning })}>
          <AutoSizer>{(options: any) => this.renderTable(options)}</AutoSizer>
        </div>
      </div>
    );
  }

  /**
   * Used by the table to get the className for a given row.
   * Called for each row.
   *
   * @private
   * @param {number} rowIndex
   * @returns {string}
   */
  private rowClassNameGetter(rowIndex: number): string {
    const { searchList, selectedIndex, ignoreSearchIndex } = this.state;
    const isSearchIndex = !ignoreSearchIndex && rowIndex === (searchList || [])[this.props.searchIndex];

    if (isSearchIndex || selectedIndex === rowIndex) {
      return 'ActiveRow';
    }

    if (searchList && searchList.includes(rowIndex)) {
      return 'HighlightRow';
    }

    return '';
  };
}