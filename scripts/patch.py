import re

with open('empty.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Add Settings Modal CSS
css_addition = """
        /* Settings Modal */
        #settings-modal {
            display: none;
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal-content {
            background: var(--sidebar-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            width: 400px;
            max-width: 90%;
            padding: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            color: var(--text-color);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 10px;
            margin-bottom: 15px;
        }
        .modal-header h2 { margin: 0; font-size: 1.2rem; }
        .close-btn { background: transparent; border: none; color: #ccc; cursor: pointer; font-size: 1.2rem; }
        .close-btn:hover { color: #fff; }
        .stat-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed rgba(255,255,255,0.1); }
        .stat-value { font-weight: bold; color: var(--accent-color); }
        
        .settings-btn {
            background: transparent;
            border: none;
            color: #aaa;
            cursor: pointer;
            font-size: 1.2rem;
            margin-left: auto;
            margin-right: 15px;
        }
        .settings-btn:hover { color: #fff; }
    </style>
"""
html = html.replace('    </style>', css_addition)

# 2. Add Gear button to Topbar
topbar_addition = """
            <button onclick="undo()" style="margin-left: 20px;" title="Undo (Ctrl+Z)">↶</button>
            <button onclick="redo()" title="Redo (Ctrl+Y)">↷</button>
        </div>
        <button class="settings-btn" onclick="openSettings()" title="Settings">⚙️</button>
    </div>
"""
html = html.replace('''            <button onclick="undo()" style="margin-left: 20px;" title="Undo (Ctrl+Z)">↶</button>
            <button onclick="redo()" title="Redo (Ctrl+Y)">↷</button>
        </div>
    </div>''', topbar_addition)

# 3. Add Modal HTML and replace Instructions with Statistics
sidebar_replacement = """
            <div class="sidebar-section">
                <h2 class="collapsible" onclick="toggleSection(this)">Document Statistics <span>▼</span></h2>
                <div class="section-content" id="doc-stats" style="font-size: 0.85rem; color: #ccc;">
                    <div class="stat-row"><span>Pages:</span> <span class="stat-value" id="stat-pages">0</span></div>
                    <div class="stat-row"><span>Locations:</span> <span class="stat-value" id="stat-locations">0</span></div>
                    <div class="stat-row"><span>Characters:</span> <span class="stat-value" id="stat-chars">0</span></div>
                    <div class="stat-row"><span>Words:</span> <span class="stat-value" id="stat-words">0</span></div>
                    <div class="stat-row"><span>Letters:</span> <span class="stat-value" id="stat-letters">0</span></div>
                    <div class="stat-row" style="margin-top: 10px;"><span>Est. Runtime:</span> <span class="stat-value" id="stat-runtime">0 min</span></div>
                </div>
            </div>
"""

instructions_regex = re.compile(r'<div class="sidebar-section">\s*<h2 class="collapsible collapsed" onclick="toggleSection\(this\)">Instructions <span>▼</span></h2>\s*<div class="section-content".*?</div>\s*</div>', re.DOTALL)
html = instructions_regex.sub(sidebar_replacement, html)

modal_html = """
    <!-- Settings Modal -->
    <div id="settings-modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Settings & Instructions</h2>
                <button class="close-btn" onclick="closeSettings()">✕</button>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="margin-top:0; font-size:1rem; border-bottom:1px solid #444; padding-bottom:5px;">Instructions</h3>
                <div style="font-size: 0.85rem; color: #bbb; line-height: 1.4;">
                    <p>Use <b>Ctrl+Z</b> and <b>Ctrl+Y</b> to undo and redo changes.</p>
                    <p>Click anywhere in the script to edit.</p>
                    <p>Use the formatting toolbar to change the style of the current line.</p>
                    <p>Press <b>Enter</b> to create a new line. The editor will automatically maintain formatting blocks.</p>
                    <p>To export to PDF, choose "Export as PDF" and use your browser's Print to PDF feature.</p>
                </div>
            </div>
            
            <div>
                <h3 style="font-size:1rem; border-bottom:1px solid #444; padding-bottom:5px;">Layout Settings</h3>
                <div style="padding: 10px 0;">
                    <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:5px;">
                        <span>Zoom</span>
                        <span id="zoom-val-modal">100%</span>
                    </div>
                    <input type="range" id="zoom-slider-modal" min="20" max="200" value="100" style="width:100%" oninput="updateZoomModal()">
                    
                    <label style="font-size: 0.85rem; margin-top: 15px; display:flex; align-items:center; gap: 8px; cursor:pointer;">
                        <input type="checkbox" id="page-breaks-toggle-modal" onchange="togglePageBreaksModal()"> Show Visual Page Breaks
                    </label>
                </div>
            </div>
        </div>
    </div>
"""
html = html.replace('</body>', modal_html + '\n</body>')

# 4. Add JavaScript for Modal and Stats
js_addition = """
        // --- Settings Modal ---
        function openSettings() {
            document.getElementById('settings-modal').style.display = 'flex';
        }
        function closeSettings() {
            document.getElementById('settings-modal').style.display = 'none';
        }
        function updateZoomModal() {
            const val = document.getElementById('zoom-slider-modal').value;
            document.getElementById('zoom-slider').value = val;
            updateZoom();
            document.getElementById('zoom-val-modal').innerText = val + '%';
        }
        function togglePageBreaksModal() {
            const isChecked = document.getElementById('page-breaks-toggle-modal').checked;
            document.getElementById('page-breaks-toggle').checked = isChecked;
            togglePageBreaks();
        }

        // --- Document Statistics ---
        function updateStatistics() {
            const editor = document.getElementById('editor-page');
            
            // 1. Calculate Pages
            const pageHeight = editor.scrollHeight;
            const pixelsPerPage = 1056; // 11in
            const numPages = Math.max(1, Math.ceil(pageHeight / pixelsPerPage));
            document.getElementById('stat-pages').innerText = numPages;
            
            // Estimated runtime: 1 page = 1 min
            const hrs = Math.floor(numPages / 60);
            const mins = numPages % 60;
            document.getElementById('stat-runtime').innerText = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
            
            // 2. Element Counts
            let locations = 0;
            let characters = 0;
            let totalWords = 0;
            let totalLetters = 0;
            
            Array.from(editor.children).forEach(child => {
                if (child.id === 'page-numbers-container' || child.classList.contains('page-break-spacer')) return;
                
                if (child.classList.contains('scene-heading')) locations++;
                if (child.classList.contains('character')) characters++;
                
                const text = child.innerText || '';
                const words = text.trim().split(/\s+/).filter(w => w.length > 0);
                totalWords += words.length;
                totalLetters += text.replace(/\s+/g, '').length;
            });
            
            document.getElementById('stat-locations').innerText = locations;
            document.getElementById('stat-chars').innerText = characters;
            document.getElementById('stat-words').innerText = totalWords.toLocaleString();
            document.getElementById('stat-letters').innerText = totalLetters.toLocaleString();
        }
"""
html = html.replace('// --- Layout Controls & Pagination ---', js_addition + '\n        // --- Layout Controls & Pagination ---')

# Wire into handleInput (it calls paginateSimulated, then later TOC/extractEntities)
html = html.replace('extractEntities();\n                saveState();', 'extractEntities();\n                updateStatistics();\n                saveState();')
html = html.replace('extractEntities();\n                        saveState();', 'extractEntities();\n                        updateStatistics();\n                        saveState();')
html = html.replace('extractEntities();\n                    saveState();', 'extractEntities();\n                    updateStatistics();\n                    saveState();')
html = html.replace('extractEntities(); \n            saveState(); \n            buildToc();', 'extractEntities(); \n            saveState(); \n            buildToc();\n            updateStatistics();')

with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(html)
