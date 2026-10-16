import type { PrefaceAPI } from '../preload/index'

declare global {
  interface Window {
    preface: PrefaceAPI
  }
}

export {}
