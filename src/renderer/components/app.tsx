import { resetState, sleuthState } from '../state/sleuth';
import { UserPreferences } from '../interfaces';
import { shouldIgnoreFile } from '../../utils/should-ignore-file';
import React from 'react';
import { ipcRenderer, remote } from 'electron';
import classNames from 'classnames';
import fs from 'fs-extra';
import path from 'path';

import { UnzippedFile, UnzippedFiles, Unzipper } from '../unzip';
import { Welcome } from './welcome';
import { CoreApplication } from './app-core';
import { MacTitlebar } from './mac-titlebar';
import { Preferences } from './preferences';
import { AppMenu } from '../menu';

const debug = require('debug')('sleuth:app');

export interface AppState {
  unzippedFiles: UnzippedFiles;
  userPreferences: UserPreferences;
}

export class App extends React.Component<undefined, Partial<AppState>> {
  public readonly menu: AppMenu = new AppMenu();

  constructor(props: undefined) {
    super(props);

    this.state = {
      unzippedFiles: []
    };

    localStorage.debug = 'sleuth*';

    this.openFile = this.openFile.bind(this);
  }

  /**
   * Should this component update?
   *
   * @param {undefined} _nextProps
   * @param {AppState} nextState
   */
  public shouldComponentUpdate(_nextProps: undefined, nextState: AppState) {
    const currentFiles = this.state.unzippedFiles || [];
    const nextFiles = nextState.unzippedFiles || [];

    if (currentFiles.length === 0 && nextFiles.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Alright, time to show the window!
   */
  public componentDidMount() {
    remote.getCurrentWindow().show();
    this.setupFileDrop();
  }

  /**
   * Whenever a file is dropped into the window, we'll try to open it
   */
  public setupFileDrop() {
    document.ondragover = document.ondrop = (event) => event.preventDefault();
    document.body.ondrop = (event) => {
      if (event.dataTransfer && event.dataTransfer.files.length > 0) {
        let url = event.dataTransfer.files[0].path;
        url = url.replace('file:///', '/');
        this.openFile(url);
      }

      event.preventDefault();
    };

    ipcRenderer.on('file-dropped', (_event: any, url: string) => this.openFile(url));
  }

  /**
   * Takes a rando string, quickly checks if it's a zip or not,
   * and either tries to open it as a file or as a folder. If
   * it's neither, we'll do nothing.
   *
   * @param {string} url
   * @returns {void}
   */
  public openFile(url: string): void {
    debug(`Received open-url for ${url}`);
    this.reset();

    const isZipFile = /[\s\S]*\.zip$/.test(url);
    if (isZipFile) {
      return this.openZip(url);
    }

    // Let's look at the url a little closer
    fs.stat(url).then((stats: fs.Stats) => {
      if (stats.isDirectory()) {
        return this.openDirectory(url);
      }
    });
  }

  /**
   * Takes a folder url as a string and opens it.
   *
   * @param {string} url
   * @returns {Promise<void>}
   */
  public async openDirectory(url: string): Promise<void> {
    debug(`Now opening directory ${url}`);
    this.reset();

    const dir = await fs.readdir(url);
    const unzippedFiles: UnzippedFiles = [];

    console.groupCollapsed(`Open directory`);

    for (const fileName of dir) {
      if (!shouldIgnoreFile(fileName)) {
        const fullPath = path.join(url, fileName);
        const stats = fs.statSync(fullPath);
        const file: UnzippedFile = { fileName, fullPath, size: stats.size };

        debug('Found file, adding to result.', file);
        unzippedFiles.push(file);
      }
    }

    this.setState({ unzippedFiles });

    console.groupEnd();
  }

  /**
   * Takes a zip file url as a string and opens it.
   *
   * @param {string} url
   */
  public openZip(url: string): void {
    const unzipper = new Unzipper(url);
    unzipper.open()
      .then(() => unzipper.unzip())
      .then((unzippedFiles: UnzippedFiles) => this.setState({unzippedFiles}));
  }

  public reset() {
    this.setState({ unzippedFiles: [] });

    if (sleuthState.opened > 0) {
      resetState();
    }

    sleuthState.opened = sleuthState.opened + 1;
  }

  /**
   * Let's render this!
   *
   * @returns {JSX.Element}
   */
  public render(): JSX.Element {
    const { unzippedFiles } = this.state;
    const className = classNames('App', { Darwin: process.platform === 'darwin' });
    const titleBar = process.platform === 'darwin' ? <MacTitlebar /> : '';
    let content: JSX.Element | null = <Welcome openFile={this.openFile} />;

    if (unzippedFiles && unzippedFiles.length > 0) {
      content = <CoreApplication state={sleuthState} unzippedFiles={unzippedFiles} />;
    }

    return (
      <div className={className}>
        <Preferences state={sleuthState} />
        {titleBar}
        {content}
      </div>
    );
  }
}
