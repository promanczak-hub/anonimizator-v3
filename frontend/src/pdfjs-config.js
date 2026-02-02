// PDF.js worker configuration for Vite
import * as pdfjsLib from 'pdfjs-dist'

// Set worker path for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`

export default pdfjsLib
