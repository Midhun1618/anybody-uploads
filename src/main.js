import { createClient } from '@supabase/supabase-js'
import './style.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
const BUCKET_NAME = 'incoming-files'
const MAX_FILE_SIZE = 25 * 1024 * 1024

const elements = {
  dropzone: document.querySelector('#dropzone'),
  input: document.querySelector('#file-input'),
  queueSection: document.querySelector('#queue-section'),
  queueCount: document.querySelector('#queue-count'),
  fileList: document.querySelector('#file-list'),
  clearButton: document.querySelector('#clear-button'),
  uploadButton: document.querySelector('#upload-button'),
  uploadButtonLabel: document.querySelector('#upload-button-label'),
  message: document.querySelector('#message'),
}

// Internal status values stay the same; this only changes what is displayed.
const STATUS_LABELS = {
  Ready: '[READY]',
  Uploading: '[....]',
  Uploaded: '[ OK ]',
  Failed: '[FAIL]',
}

let supabase = null
let selectedFiles = []
let isUploading = false

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
} else {
  showMessage(
    '[ERROR] missing env: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env, then restart the dev server.',
    'error'
  )
}

elements.dropzone.addEventListener('click', () => {
  if (!isUploading) elements.input.click()
})

elements.input.addEventListener('change', (event) => {
  addFiles(event.target.files)
  event.target.value = ''
})

elements.clearButton.addEventListener('click', () => {
  if (isUploading) return
  selectedFiles = []
  renderQueue()
  hideMessage()
})

elements.uploadButton.addEventListener('click', uploadFiles)

;['dragenter', 'dragover'].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault()
    if (!isUploading) elements.dropzone.classList.add('is-dragging')
  })
})

;['dragleave', 'drop'].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault()
    elements.dropzone.classList.remove('is-dragging')
  })
})

elements.dropzone.addEventListener('drop', (event) => {
  if (!isUploading && event.dataTransfer?.files) {
    addFiles(event.dataTransfer.files)
  }
})

function addFiles(fileList) {
  hideMessage()
  const incoming = Array.from(fileList || [])
  let rejected = 0

  for (const file of incoming) {
    if (file.size > MAX_FILE_SIZE) {
      rejected += 1
      continue
    }

    // Avoid duplicate selections in the same upload queue.
    const duplicate = selectedFiles.some(
      (item) => item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
    )

    if (!duplicate) {
      selectedFiles.push({
        id: crypto.randomUUID(),
        file,
        status: 'Ready',
        uploadedAt: null,
      })
    }
  }

  renderQueue()

  if (rejected > 0) {
    showMessage(
      `[ERROR] ${rejected} file(s) exceed MAX=25MB and were skipped.`,
      'error'
    )
  }
}

function renderQueue() {
  const hasFiles = selectedFiles.length > 0
  elements.queueSection.hidden = !hasFiles
  elements.queueCount.textContent = `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} queued`
  elements.uploadButton.disabled = !hasFiles || isUploading || !supabase
  elements.uploadButtonLabel.textContent = isUploading ? '[ EXECUTING... ]' : '[ EXECUTE ]'
  elements.fileList.innerHTML = ''

  selectedFiles.forEach((item) => {
    const li = document.createElement('li')
    li.className = 'file-row'

    const icon = document.createElement('span')
    icon.className = 'file-type-icon'
    icon.innerHTML = getFileIcon(item.file.name)

    const details = document.createElement('span')
    details.className = 'file-details'

    const name = document.createElement('span')
    name.className = 'file-name'
    name.textContent = item.file.name
    name.title = item.file.name

    const meta = document.createElement('span')
    meta.className = 'file-meta'
    meta.textContent = `${formatBytes(item.file.size)} · 0b${toBinary(item.file.size)}${item.uploadedAt ? ` · ${item.uploadedAt}` : ''}`

    details.append(name, meta)

    const status = document.createElement('span')
    status.className = `file-status ${item.status === 'Uploaded' ? 'is-success' : item.status === 'Failed' ? 'is-error' : ''}`
    status.textContent = STATUS_LABELS[item.status] || item.status

    li.append(icon, details, status)

    if (!isUploading && item.status !== 'Uploaded') {
      const remove = document.createElement('button')
      remove.className = 'remove-button'
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${item.file.name}`)
      remove.textContent = '[x]'
      remove.addEventListener('click', () => {
        selectedFiles = selectedFiles.filter((file) => file.id !== item.id)
        renderQueue()
      })
      li.append(remove)
    }

    elements.fileList.append(li)
  })
}

async function uploadFiles() {
  if (!supabase || isUploading) return

  const pending = selectedFiles.filter((item) => item.status !== 'Uploaded')
  if (pending.length === 0) return

  isUploading = true
  hideMessage()
  renderQueue()
  elements.dropzone.classList.add('is-disabled')

  let succeeded = 0
  let failed = 0

  for (const item of pending) {
    item.status = 'Uploading'
    renderQueue()

    try {
      const path = buildStoragePath(item.file.name)
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, item.file, {
          cacheControl: '3600',
          upsert: false,
          contentType: item.file.type || 'application/octet-stream',
        })

      if (error) throw error

      item.status = 'Uploaded'
      item.uploadedAt = new Date().toLocaleString()
      succeeded += 1
    } catch (error) {
      console.error('Upload failed:', error)
      item.status = 'Failed'
      failed += 1
    }

    renderQueue()
  }

  isUploading = false
  elements.dropzone.classList.remove('is-disabled')
  renderQueue()

  if (failed === 0) {
    showMessage(
      `[ OK ] ${succeeded} file${succeeded === 1 ? '' : 's'} uploaded.\nexit code: 0`,
      'success'
    )
  } else {
    showMessage(
      `[FAIL] ${succeeded} uploaded, ${failed} failed. retry the failed files.\nexit code: 1`,
      'error'
    )
  }
}

function buildStoragePath(originalName) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const safeName = originalName
    .normalize('NFKD')
    .replace(/[^\w.\-() ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100) || 'file'

  return `uploads/${year}/${month}/${day}/${crypto.randomUUID()}-${safeName}`
}

function getFileIcon(name) {
  const extension = name.split('.').pop()?.toLowerCase() || ''
  const known = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'mp3', 'txt']
  const label = known.includes(extension) ? extension.slice(0, 4).toUpperCase() : 'FILE'
  return `<span>[${label}]</span>`
}

function toBinary(n) {
  return n.toString(2).padStart(8, '0')
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function showMessage(message, type) {
  elements.message.textContent = message
  elements.message.className = `message ${type}`
  elements.message.hidden = false
}

function hideMessage() {
  elements.message.hidden = true
  elements.message.textContent = ''
}
