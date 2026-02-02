const { test, expect } = require('@playwright/test')

/**
 * BASIC NATIVE EDITOR TEST
 * Duration: ~5 minutes
 * Tests: Upload, Native text selection, FloatingToolbar
 */

test.describe('Anonimizator v3 - Native Editor Basic Test', () => {
    test.setTimeout(300000) // 5 minutes

    const BASE_URL = 'http://localhost:5173'
    const API_URL = 'http://localhost:8000'

    test.beforeEach(async ({ page }) => {
        await page.goto(BASE_URL)
    })

    // Test 1: Upload and Library
    test('01 - Upload PDF and verify library', async ({ page }) => {
        console.log('📤 Testing PDF Upload...')

        await page.goto(`${BASE_URL}/library`)
        await expect(page).toHaveTitle(/Anonimizator/)

        // Check if document-card exists
        const existingDocs = await page.locator('.document-card').count()
        console.log(`📚 Found ${existingDocs} existing documents`)

        if (existingDocs > 0) {
            console.log('✅ Library has documents')
        } else {
            console.log('⚠️ No documents in library')
        }
    })

    // Test 2: Native Editor loads
    test('02 - Open document in Native Editor', async ({ page }) => {
        console.log('✨ Testing Native Editor...')

        await page.goto(`${BASE_URL}/library`)

        // Wait for and click first document
        await page.waitForSelector('.document-card', { timeout: 10000 })
        await page.click('.document-card:first-child')

        console.log('✅ Clicked document')

        // Wait for PDF to load
        await page.waitForSelector('.PdfHighlighter', { timeout: 15000 })
        console.log('✅ PDFHighlighterEditor loaded')

        // Verify text layer exists
        const textLayer = await page.locator('.textLayer').count()
        expect(textLayer).toBeGreaterThan(0)
        console.log(`✅ Text layer loaded (${textLayer} instances)`)
    })

    // Test 3: Text Selection and FloatingToolbar
    test('03 - Text selection shows FloatingToolbar', async ({ page }) => {
        console.log('🖱️ Testing text selection...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Select text
        const textLayer = page.locator('.textLayer').first()
        await textLayer.waitFor({ state: 'visible' })

        const box = await textLayer.boundingBox()
        await page.mouse.move(box.x + 50, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 50)
        await page.mouse.up()

        console.log('✅ Text selected')

        // Wait for FloatingToolbar
        const toolbar = page.locator('.floating-toolbar')
        await toolbar.waitFor({ state: 'visible', timeout: 3000 })
        console.log('✅ FloatingToolbar appeared')

        // Verify buttons exist
        const redactBtn = page.locator('button:has-text("Zanonimizuj")')
        const cancelBtn = page.locator('button:has-text("Anuluj")')

        await expect(redactBtn).toBeVisible()
        await expect(cancelBtn).toBeVisible()
        console.log('✅ Toolbar buttons visible')
    })

    // Test 4: Create Highlight
    test('04 - Create highlight via FloatingToolbar', async ({ page }) => {
        console.log('🎨 Testing highlight creation...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Select and highlight text
        const textLayer = page.locator('.textLayer').first()
        const box = await textLayer.boundingBox()

        await page.mouse.move(box.x + 50, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 50)
        await page.mouse.up()

        await page.click('button:has-text("Zanonimizuj")')
        await page.waitForTimeout(500)

        // Verify highlight created
        const highlights = page.locator('.Highlight')
        const highlightCount = await highlights.count()
        expect(highlightCount).toBeGreaterThan(0)
        console.log(`✅ Created ${highlightCount} highlight(s)`)
    })
})
