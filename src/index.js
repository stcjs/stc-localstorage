import Plugin from 'stc-plugin';
import {extend, isRemoteUrl} from 'stc-helper';

export default class LocalstoragePlugin extends Plugin {
  /**
   * run
   */
  async run(){
  }

  /**
   * update
   */
  update(){
  }

  /**
   * use cluster
   */
  static cluster(){
    return false;
  }

  /**
   * use cache
   */
  static cache(){
    return true;
  }
}
