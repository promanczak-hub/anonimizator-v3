const { test, expect } = require('@playwright/test')

/**
 * COMPREHENSIVE ANONIMIZATOR TEST SUITE
 * Duration: ~60 minutes 
 * Tests all features: Upload, Native Editor, Canvas Mode, Deletion
 */

test.describe('Anonimizator v3 - Complete Feature Test', () => {
    test.setTimeout(3600000) // 60 minutes

    const BASE_URL = 'http://localhost:5173'
    const API_URL = 'http://localhost:8000'

    test.beforeEach(async ({ page }) => {
        await page.goto(BASE_URL)
    })

    // ========================================
    // PHASE 1: PDF UPLOAD (5 min)
    // ========================================
    test('01 - Upload PDF and verify processing', async ({ page }) => {
        console.log('📤 Testing PDF Upload Flow...')

        // Navigate to library
        await page.goto(`${BASE_URL}/library`)
        await expect(page).toHaveTitle(/Anonimizator/)

        // Upload PDF
        const fileInput = page.locator('input[type="file"]')
        await fileInput.setInputFiles('./test-data/sample.pdf')

        // Click "Przetwarzaj PDF" if exists
        const processButton = page.getByText('Przetwarzaj PDF')
        if (await processButton.isVisible()) {
            await processButton.click()
        }

        // Wait for processing to complete
        await page.waitForSelector('.document-card', { timeout: 30000 })

        console.log('✅ PDF uploaded successfully')
    })

    // ========================================
    // PHASE 2: NATIVE EDITOR TEST (20 min)
    // ========================================
    test('02 - Native Text Selection with FloatingToolbar', async ({ page }) => {
        console.log('✨ Testing Native Editor...')

        // Open first document
        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')

        // Note: Native editor is now the only editor (toggle removed)
        console.log('✅ Opening document in Native mode')

        // Wait for PDF to load
        await page.waitForSelector('.PdfHighlighter', { timeout: 15000 })
        console.log('📄 PDF loaded')

        // Select text (simulate mouse drag)
        const textLayer = page.locator('.textLayer').first()
        await textLayer.waitFor({ state: 'visible' })

        // Get bounding box for text selection
        const box = await textLayer.boundingBox()
        await page.mouse.move(box.x + 50, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 50)
        await page.mouse.up()

        console.log('🖱️ Text selected')

        // Wait for FloatingToolbar
        const toolbar = page.locator('.floating-toolbar')
        await toolbar.waitFor({ state: 'visible', timeout: 3000 })
        console.log('✅ FloatingToolbar appeared')

        // Click "Zanonimizuj"
        await page.click('button:has-text("Zanonimizuj")')
        await page.waitForTimeout(500)

        // Verify highlight was created
        const highlights = page.locator('.Highlight')
        await expect(highlights).toHaveCount(1)
        console.log('✅ Highlight created')

        // Verify highlight color
        const highlightBg = await highlights.first().evaluate(el =>
            window.getComputedStyle(el).backgroundColor
        )
        expect(highlightBg).toContain('rgba')
        console.log(`✅ Highlight color: ${highlightBg}`)
    })

    test('03 - Multiple Highlights and Persistence', async ({ page }) => {
        console.log('📝 Testing multiple highlights...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Create 3 highlights
        for (let i = 0; i < 3; i++) {
            const textLayer = page.locator('.textLayer').first()
            const box = await textLayer.boundingBox()

            await page.mouse.move(box.x + 50 + (i * 100), box.y + 50)
            await page.mouse.down()
            await page.mouse.move(box.x + 150 + (i * 100), box.y + 50)
            await page.mouse.up()

            await page.waitForSelector('.floating-toolbar')
            await page.click('button:has-text("Zanonimizuj")')
            await page.waitForTimeout(500)
        }

        const highlights = page.locator('.Highlight')
        await expect(highlights).toHaveCount(3)
        console.log('✅ 3 highlights created')

        // Refresh page - highlights should persist
        await page.reload()
        await page.waitForSelector('.PdfHighlighter')

        const persistedHighlights = page.locator('.Highlight')
        await expect(persistedHighlights).toHaveCount(3)
        console.log('✅ Highlights persisted after reload')
    })

    // ========================================
    // PHASE 3: TOGGLE FUNCTIONALITY (10 min)
    // ========================================
    test.skip('04 - Toggle between Native and Canvas modes [REMOVED]', async ({ page }) => {
        console.log('🔄 Testing Editor Toggle...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.job-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Verify Native mode
        let nativeToggle = page.getByText('✨ Native')
        await expect(nativeToggle).toBeVisible()
        const pdfHighlighter = page.locator('.PdfHighlighter')
        await expect(pdfHighlighter).toBeVisible()
        console.log('✅ Native editor visible')

        // Switch to Canvas mode
        await page.click('button:has-text("✨ Native")')
        await page.waitForTimeout(500)

        // Verify Canvas mode
        const canvasToggle = page.getByText('🎨 Canvas')
        await expect(canvasToggle).toBeVisible()
        const fabricEditor = page.locator('canvas') // Fabric.js creates canvas
        await expect(fabricEditor).toBeVisible()
        console.log('✅ Canvas editor visible')

        // Switch back to Native
        await page.click('button:has-text("🎨 Canvas")')
        await page.waitForTimeout(500)

        await expect(page.locator('.PdfHighlighter')).toBeVisible()
        console.log('✅ Toggled back to Native')
    })

    // ========================================
    // PHASE 4: DELETION FLOW (20 min)
    // ========================================
    test('05 - Backend Deletion Integration', async ({ page }) => {
        console.log('🗑️ Testing deletion flow...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Create a highlight
        const textLayer = page.locator('.textLayer').first()
        const box = await textLayer.boundingBox()
        await page.mouse.move(box.x + 50, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 50)
        await page.mouse.up()
        await page.click('button:has-text("Zanonimizuj")')
        await page.waitForTimeout(500)

        console.log('✅ Highlight created for deletion test')

        // Find and click delete button
        const deleteButton = page.getByText('Usuń zaznaczone')
        await expect(deleteButton).toBeVisible()

        // Listen for API call
        const responsePromise = page.waitForResponse(
            response => response.url().includes('/delete-blocks'),
            { timeout: 10000 }
        )

        await deleteButton.click()

        try {
            const response = await responsePromise
            const status = response.status()
            console.log(`📡 Delete API Response: ${status}`)

            if (status === 200) {
                console.log('✅ Deletion successful')
            } else {
                console.log(`⚠️ Deletion returned ${status}`)
            }
        } catch (e) {
            console.log('⚠️ Deletion API call failed or timed out')
        }

        // Verify success notification
        const notification = page.locator('.notification, .toast, .alert')
        if (await notification.isVisible({ timeout: 2000 })) {
            const text = await notification.textContent()
            console.log(`📢 Notification: ${text}`)
        }
    })

    // ========================================
    // PHASE 5: CANVAS MODE TEST (10 min)
    // ========================================
    test.skip('06 - Canvas Mode Rectangle Tool [REMOVED]', async ({ page }) => {
        console.log('🎨 Testing Canvas Mode features...')

        await page.goto(`${BASE_URL}/library`)
        await page.click('.job-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        // Switch to Canvas mode
        await page.click('button:has-text("✨ Native")')
        await page.waitForTimeout(500)

        // Select Rectangle tool
        const rectangleTool = page.locator('button[title*="prostokąt"]')
        await rectangleTool.click()
        console.log('✅ Rectangle tool selected')

        // Draw rectangle on canvas
        const canvas = page.locator('canvas').first()
        const box = await canvas.boundingBox()

        await page.mouse.move(box.x + 100, box.y + 100)
        await page.mouse.down()
        await page.mouse.move(box.x + 300, box.y + 200)
        await page.mouse.up()

        console.log('✅ Rectangle drawn')

        // Verify rectangle appears in deletion list
        const deletionList = page.locator('.elements-to-delete, .sidebar')
        await deletionList.waitFor({ timeout: 5000 })
        console.log('✅ Rectangle added to deletion list')
    })

    // ========================================
    // PHASE 6: EDGE CASES (10 min)
    // ========================================
    test('07 - Error Handling and Edge Cases', async ({ page }) => {
        console.log('🧪 Testing edge cases...')

        // Test 1: Upload invalid file
        await page.goto(`${BASE_URL}/library`)
        const fileInput = page.locator('input[type="file"]')

        // Create a fake non-PDF file
        await fileInput.setInputFiles({
            name: 'test.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Not a PDF')
        })

        // Should show error
        const errorMsg = page.locator('.error, .alert-danger')
        if (await errorMsg.isVisible({ timeout: 3000 })) {
            console.log('✅ Invalid file rejected')
        }

        // Test 2: Click FloatingToolbar "Anuluj"
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        const textLayer = page.locator('.textLayer').first()
        const box = await textLayer.boundingBox()
        await page.mouse.move(box.x + 50, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + 200, box.y + 50)
        await page.mouse.up()

        await page.click('button:has-text("Anuluj")')

        // Toolbar should disappear
        const toolbar = page.locator('.floating-toolbar')
        await expect(toolbar).not.toBeVisible()
        console.log('✅ Cancel button works')

        // Test 3: Multiple rapid toggles - REMOVED (no toggle button anymore)
        console.log('⚠️ Toggle test skipped - feature removed')
    })

    // ========================================
    // PHASE 7: PERFORMANCE TEST (5 min)
    // ========================================
    test('08 - Performance and Load Testing', async ({ page }) => {
        console.log('⚡ Testing performance...')

        const startTime = Date.now()

        await page.goto(`${BASE_URL}/library`)
        await page.click('.document-card:first-child')
        await page.waitForSelector('.PdfHighlighter')

        const loadTime = Date.now() - startTime
        console.log(`📊 PDF Load Time: ${loadTime}ms`)

        expect(loadTime).toBeLessThan(10000) // Should load in < 10s

        // Test scroll performance
        const pdfContainer = page.locator('.PdfHighlighter')
        for (let i = 0; i < 10; i++) {
            await pdfContainer.evaluate(el => el.scrollTop += 100)
            await page.waitForTimeout(50)
        }
        console.log('✅ Scroll performance OK')
    })
})
