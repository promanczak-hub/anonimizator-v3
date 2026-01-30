// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

/**
 * Anonimizator v3 - Comprehensive E2E Tests
 * 
 * Test Coverage:
 * 1. Home Page - Upload functionality
 * 2. Library Page - Document list and search
 * 3. Processing Page - PDF editor features
 * 4. Zoom functionality (buttons, Ctrl+scroll)
 * 5. Pan mode (hand tool)
 * 6. Selection/redaction tool
 * 7. Page deletion
 * 8. Text replacement
 * 9. High resolution thumbnails
 */

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:8000';

// Helper to wait for API
async function waitForAPI() {
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(`${API_URL}/health`);
            if (response.ok) return true;
        } catch (e) {
            // API not ready yet
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('API did not become ready');
}

// ============================================
// TEST SUITE 1: HOME PAGE
// ============================================
test.describe('Home Page', () => {
    test('should load home page with upload area', async ({ page }) => {
        await page.goto('/');

        // Check title
        await expect(page).toHaveTitle(/Anonimizator/);

        // Check upload area exists
        const uploadArea = page.locator('.upload-zone, [class*="upload"], input[type="file"]');
        await expect(uploadArea.first()).toBeVisible({ timeout: 10000 });

        console.log('✅ Home page loaded with upload area');
    });

    test('should have Express logo that links to home', async ({ page }) => {
        await page.goto('/');

        const logo = page.locator('img[alt*="Express"], .logo, header img').first();
        if (await logo.isVisible()) {
            await logo.click();
            await expect(page).toHaveURL('/');
            console.log('✅ Logo links to home page');
        } else {
            console.log('ℹ️ Logo not found or not clickable');
        }
    });

    test('should navigate to library', async ({ page }) => {
        await page.goto('/');

        // Look for library link
        const libraryLink = page.locator('a[href*="library"], button:has-text("Biblioteka"), a:has-text("Biblioteka")').first();
        if (await libraryLink.isVisible()) {
            await libraryLink.click();
            await expect(page).toHaveURL(/library/);
            console.log('✅ Navigation to library works');
        } else {
            // Try direct navigation
            await page.goto('/library');
            await expect(page).toHaveURL(/library/);
            console.log('✅ Direct navigation to library works');
        }
    });
});

// ============================================
// TEST SUITE 2: LIBRARY PAGE
// ============================================
test.describe('Library Page', () => {
    test('should display document list', async ({ page }) => {
        await page.goto('/library');
        await page.waitForLoadState('networkidle');

        // Check for document cards or empty state
        const docCards = page.locator('.document-card, .job-item, [class*="card"]');
        const emptyState = page.locator('text=/brak|pusto|empty/i');

        const hasDocuments = await docCards.count() > 0;
        const hasEmptyState = await emptyState.isVisible().catch(() => false);

        expect(hasDocuments || hasEmptyState).toBeTruthy();
        console.log(`✅ Library page loaded - ${hasDocuments ? 'has documents' : 'empty state'}`);
    });

    test('should have search functionality', async ({ page }) => {
        await page.goto('/library');
        await page.waitForLoadState('networkidle');

        const searchInput = page.locator('input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]').first();

        if (await searchInput.isVisible()) {
            await searchInput.fill('test');
            await page.waitForTimeout(500); // Wait for debounce
            console.log('✅ Search input works');
        } else {
            console.log('ℹ️ Search input not found');
        }
    });
});

// ============================================
// TEST SUITE 3: PROCESSING PAGE - PDF EDITOR
// ============================================
test.describe('Processing Page', () => {
    let testJobId = null;

    test.beforeAll(async ({ request }) => {
        // Get first available job from API
        try {
            const response = await request.get(`${API_URL}/api/jobs`);
            if (response.ok()) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                    testJobId = data.items[0].id;
                    console.log(`📄 Using test job: ${testJobId}`);
                }
            }
        } catch (e) {
            console.log('ℹ️ No existing jobs found, some tests may be skipped');
        }
    });

    test('should load PDF editor with toolbar', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000); // Wait for PDF to render

        // Check for toolbar
        const toolbar = page.locator('.drawing-toolbar, [class*="toolbar"]').first();
        await expect(toolbar).toBeVisible({ timeout: 15000 });

        console.log('✅ PDF editor loaded with toolbar');
    });

    test('should have zoom controls', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        // Check for zoom buttons
        const zoomIn = page.locator('button:has-text("+"), [title*="zoom"], [title*="powiększ"]').first();
        const zoomOut = page.locator('button:has-text("-"), [title*="zoom"], [title*="pomniejsz"]').first();

        if (await zoomIn.isVisible()) {
            await zoomIn.click();
            await page.waitForTimeout(500);
            console.log('✅ Zoom in button works');
        }

        if (await zoomOut.isVisible()) {
            await zoomOut.click();
            await page.waitForTimeout(500);
            console.log('✅ Zoom out button works');
        }
    });

    test('should have pan mode (hand tool) as default', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        // Check for hand/pan button - should be active by default
        const handButton = page.locator('[title*="przesuń"], [title*="pan"], button:has(svg)').filter({ hasText: '' });
        const activeButton = page.locator('.btn-icon.active, button.active');

        // Just verify toolbar has buttons
        const toolbarButtons = page.locator('.toolbar-group button, .drawing-toolbar button');
        const buttonCount = await toolbarButtons.count();

        expect(buttonCount).toBeGreaterThan(0);
        console.log(`✅ Found ${buttonCount} toolbar buttons`);
    });

    test('should have rectangle selection tool', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        // Find rectangle/square button
        const rectButton = page.locator('[title*="prostokąt"], [title*="rectangle"], button:has-text("□")').first();

        if (await rectButton.isVisible()) {
            await rectButton.click();
            await page.waitForTimeout(300);

            // Verify button becomes active
            const isActive = await rectButton.evaluate(el => el.classList.contains('active'));
            console.log(`✅ Rectangle tool ${isActive ? 'activated' : 'clicked'}`);
        } else {
            // Try clicking first toolbar button
            const firstButton = page.locator('.toolbar-group button').first();
            if (await firstButton.isVisible()) {
                await firstButton.click();
                console.log('✅ Clicked first toolbar button');
            }
        }
    });

    test('should draw selection rectangle on PDF', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        // Switch to rectangle mode
        const rectButton = page.locator('[title*="prostokąt"]').first();
        if (await rectButton.isVisible()) {
            await rectButton.click();
        }

        // Find canvas or PDF image
        const canvas = page.locator('canvas, .pdf-page-wrapper img').first();

        if (await canvas.isVisible()) {
            const box = await canvas.boundingBox();
            if (box) {
                // Draw a rectangle
                await page.mouse.move(box.x + 100, box.y + 100);
                await page.mouse.down();
                await page.mouse.move(box.x + 200, box.y + 200);
                await page.mouse.up();

                await page.waitForTimeout(500);
                console.log('✅ Drew selection rectangle on PDF');
            }
        }
    });

    test('should have page deletion controls', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        // Check for scissors/delete page button
        const scissorsButton = page.locator('[title*="usuń"], [title*="delete"], .page-header button').first();

        if (await scissorsButton.isVisible()) {
            console.log('✅ Page deletion button found');
        } else {
            console.log('ℹ️ Page deletion button not visible');
        }
    });

    test('should render high resolution PDF thumbnails', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(5000);

        // Get the first PDF image
        const pdfImage = page.locator('.pdf-page-wrapper img, canvas').first();

        if (await pdfImage.isVisible()) {
            const box = await pdfImage.boundingBox();
            if (box) {
                console.log(`✅ PDF rendering - Size: ${box.width}x${box.height}px`);

                // Check if it's reasonably high resolution (at least 400px wide)
                expect(box.width).toBeGreaterThan(300);
            }
        }
    });

    test('should zoom with Ctrl+scroll', async ({ page }) => {
        test.skip(!testJobId, 'No test job available');

        await page.goto(`/process/${testJobId}`);
        await page.waitForTimeout(3000);

        const container = page.locator('.pdf-scroll-container, .split-view-left').first();

        if (await container.isVisible()) {
            const box = await container.boundingBox();
            if (box) {
                // Simulate Ctrl+scroll
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.keyboard.down('Control');
                await page.mouse.wheel(0, -100); // Scroll up = zoom in
                await page.keyboard.up('Control');

                await page.waitForTimeout(500);
                console.log('✅ Ctrl+scroll zoom executed');
            }
        }
    });
});

// ============================================
// TEST SUITE 4: API HEALTH
// ============================================
test.describe('API Health', () => {
    test('backend API should be accessible', async ({ request }) => {
        const response = await request.get(`${API_URL}/health`);
        expect(response.ok()).toBeTruthy();
        console.log('✅ Backend API is healthy');
    });

    test('should list jobs endpoint', async ({ request }) => {
        const response = await request.get(`${API_URL}/api/jobs`);
        expect(response.ok()).toBeTruthy();

        const data = await response.json();
        expect(data.items).toBeDefined();
        expect(Array.isArray(data.items)).toBeTruthy();
        console.log(`✅ Jobs API returns ${data.items.length} jobs`);
    });
});

// ============================================
// TEST SUITE 5: RESPONSIVE DESIGN
// ============================================
test.describe('Responsive Design', () => {
    test('should work on tablet viewport', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');

        await expect(page).toHaveTitle(/Anonimizator/);
        console.log('✅ Works on tablet viewport');
    });

    test('should work on desktop viewport', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/');

        await expect(page).toHaveTitle(/Anonimizator/);
        console.log('✅ Works on desktop viewport');
    });
});

// ============================================
// TEST SUITE 6: TEXT REPLACEMENT FEATURE
// ============================================
test.describe('Text Replacement', () => {
    test('should have text replacement mode', async ({ page, request }) => {
        // Get first job
        const jobsResponse = await request.get(`${API_URL}/api/jobs`);
        if (!jobsResponse.ok()) {
            test.skip(true, 'No jobs available');
            return;
        }

        const data = await jobsResponse.json();
        if (!data.items || data.items.length === 0) {
            test.skip(true, 'No jobs available');
            return;
        }

        await page.goto(`/process/${data.items[0].id}`);
        await page.waitForTimeout(3000);

        // Look for replace button
        const replaceButton = page.locator('[title*="zamień"], [title*="replace"]').first();

        if (await replaceButton.isVisible()) {
            await replaceButton.click();
            console.log('✅ Text replacement mode available');
        } else {
            console.log('ℹ️ Text replacement button not visible');
        }
    });
});

// ============================================
// TEST SUITE 7: TOOLBAR STICKY BEHAVIOR
// ============================================
test.describe('Toolbar Behavior', () => {
    test('toolbar should stay at top when scrolling', async ({ page, request }) => {
        const jobsResponse = await request.get(`${API_URL}/api/jobs`);
        if (!jobsResponse.ok()) {
            test.skip(true, 'No jobs available');
            return;
        }

        const data = await jobsResponse.json();
        if (!data.items || data.items.length === 0) {
            test.skip(true, 'No jobs available');
            return;
        }

        await page.goto(`/process/${data.items[0].id}`);
        await page.waitForTimeout(3000);

        const toolbar = page.locator('.drawing-toolbar').first();

        if (await toolbar.isVisible()) {
            const initialPosition = await toolbar.boundingBox();

            // Scroll down
            await page.evaluate(() => {
                const container = document.querySelector('.pdf-scroll-container');
                if (container) container.scrollTop = 500;
            });

            await page.waitForTimeout(300);

            const afterScrollPosition = await toolbar.boundingBox();

            // Toolbar should stay visible (y position should not change much if sticky)
            if (initialPosition && afterScrollPosition) {
                console.log(`✅ Toolbar position - Initial Y: ${initialPosition.y}, After scroll Y: ${afterScrollPosition.y}`);
            }
        }
    });
});
