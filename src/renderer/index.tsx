import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { translate } from '../shared/i18n'
import { initialUiLanguage } from './store'

// 设置加载前先用本地镜像设定语言和标题，避免英文模式先闪一帧中文
const initialLanguage = initialUiLanguage()
document.documentElement.lang = initialLanguage === 'en' ? 'en' : 'zh-CN'
document.title = translate(initialLanguage, 'app.title')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
