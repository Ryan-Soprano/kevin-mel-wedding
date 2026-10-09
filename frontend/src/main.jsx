import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import Root from './app/Root.jsx'

const privateArchive = new URLSearchParams(window.location.search).get('view') === 'inbox'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root privateArchive={privateArchive} />
  </StrictMode>,
)
