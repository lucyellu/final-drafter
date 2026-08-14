
        // --- State Management ---
        let appState = {
            characters: [],
            locations: []
        };
        
        let dynamicCounts = { characters: {}, locations: {} };
        
        // Highlight tracking
        let activeHighlights = new Set();

        function switchTab(tabName) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            if (tabName === 'characters') {
                document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
                document.getElementById('tab-characters').classList.add('active');
            } else {
                document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
                document.getElementById('tab-locations').classList.add('active');
            }
        }

        function getRandomColor() {
            const hue = Math.floor(Math.random() * 360);
            return `hsl(${hue}, 70%, 60%)`;
        }

        function extractEntities() {
            dynamicCounts = { characters: {}, locations: {} };
            const entityNodes = { characters: {}, locations: {} };
            
            let charIdx = 0;
            document.querySelectorAll('.character').forEach(node => {
                let name = node.innerText.replace(/\s*\(.*?\)/g, '').trim().toUpperCase();
                if (!name) return;
                dynamicCounts.characters[name] = (dynamicCounts.characters[name] || 0) + 1;
                
                if (!entityNodes.characters[name]) entityNodes.characters[name] = [];
                if (!node.id) node.id = 'char-' + Date.now() + '-' + (charIdx++);
                entityNodes.characters[name].push(node);
                
                if (!appState.characters.find(c => c.name === name)) {
                    appState.characters.push({ id: Date.now() + Math.random(), name: name, color: getRandomColor() });
                }
            });
            
            let locIdx = 0;
            document.querySelectorAll('.scene-heading').forEach(node => {
                let text = node.innerText.trim().toUpperCase();
                let match = text.match(/^(?:INT\.|EXT\.|I\/E\.|INT\/EXT\.)\s+(.*?)(?:\s+-\s+.*)?$/);
                let name = match ? match[1].trim() : text;
                if (!name) return;
                dynamicCounts.locations[name] = (dynamicCounts.locations[name] || 0) + 1;
                
                if (!entityNodes.locations[name]) entityNodes.locations[name] = [];
                if (!node.id) node.id = 'loc-' + Date.now() + '-' + (locIdx++);
                entityNodes.locations[name].push(node);
                
                if (!appState.locations.find(l => l.name === name)) {
                    appState.locations.push({ id: Date.now() + Math.random(), name: name, color: getRandomColor() });
                }
            });
            
            appState.characters.sort((a, b) => (dynamicCounts.characters[b.name] || 0) - (dynamicCounts.characters[a.name] || 0));
            appState.locations.sort((a, b) => (dynamicCounts.locations[b.name] || 0) - (dynamicCounts.locations[a.name] || 0));
            
            renderLists(entityNodes);
            drawPageNumbers();
        }

        function renderLists(entityNodes) {
            const charList = document.getElementById('characters-list');
            const locList = document.getElementById('locations-list');
            charList.innerHTML = '';
            locList.innerHTML = '';
            
            appState.characters.forEach(item => {
                const count = dynamicCounts.characters[item.name] || 0;
                if (count > 0 || activeHighlights.has(item.id)) {
                    const nodesList = entityNodes.characters[item.name] || [];
                    charList.appendChild(createListItemEl(item, 'characters', count, nodesList));
                }
            });
            appState.locations.forEach(item => {
                const count = dynamicCounts.locations[item.name] || 0;
                if (count > 0 || activeHighlights.has(item.id)) {
                    const nodesList = entityNodes.locations[item.name] || [];
                    locList.appendChild(createListItemEl(item, 'locations', count, nodesList));
                }
            });
        }

        function createListItemEl(item, type, count, nodesList) {
            const liContainer = document.createElement('div');
            liContainer.className = 'list-item-container';
            
            const li = document.createElement('li');
            li.className = 'list-item main-item';
            if (activeHighlights.has(item.id)) {
                li.classList.add('highlighted');
                li.style.borderLeftColor = item.color;
            }
            
            const left = document.createElement('div');
            left.className = 'list-item-left';
            left.innerHTML = `<span class="toggle-arrow">▶</span> <span class="list-item-color" style="background-color: ${item.color}"></span> 
                              <span class="item-name" title="${item.name}">${item.name}</span>
                              <span class="item-count">${count}</span>`;
            
            const actions = document.createElement('div');
            actions.className = 'item-actions';
            
            const addBtn = document.createElement('button');
            addBtn.innerHTML = '+';
            addBtn.title = "Insert block at cursor";
            addBtn.onclick = (e) => {
                e.stopPropagation();
                insertBlockAtCursor(type, item.name);
            };
            actions.appendChild(addBtn);
            
            li.appendChild(left);
            li.appendChild(actions);
            
            // Nested Children
            const childrenUl = document.createElement('ul');
            childrenUl.className = 'nested-list';
            childrenUl.style.display = 'none';
            
            if (nodesList && nodesList.length > 0) {
                nodesList.forEach((n, idx) => {
                    const childLi = document.createElement('li');
                    childLi.className = 'nested-list-item';
                    
                    let snippet = n.innerText.trim();
                    if (type === 'characters') {
                        let next = n.nextElementSibling;
                        while(next && next.classList.contains('parenthetical')) next = next.nextElementSibling;
                        if (next && next.classList.contains('dialogue')) {
                            snippet = next.innerText.trim();
                        }
                    }
                    if (snippet.length > 30) snippet = snippet.substring(0, 30) + '...';
                    
                    childLi.innerHTML = `<span>${idx+1}. "${snippet}"</span> <button class="delete-btn" title="Delete block">×</button>`;
                    
                    childLi.onclick = (e) => {
                        if (e.target.tagName === 'BUTTON') {
                            e.stopPropagation();
                            if (type === 'characters') {
                                let next = n.nextElementSibling;
                                while(next && next.classList.contains('parenthetical')) {
                                    let p = next;
                                    next = next.nextElementSibling;
                                    p.remove();
                                }
                                if (next && next.classList.contains('dialogue')) next.remove();
                            }
                            n.remove();
                            extractEntities();
                            saveState();
                        } else {
                            e.stopPropagation();
                            n.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            const oldBg = n.style.backgroundColor;
                            n.style.backgroundColor = "rgba(255,255,0,0.5)";
                            setTimeout(() => { n.style.backgroundColor = oldBg; }, 800);
                        }
                    };
                    childrenUl.appendChild(childLi);
                });
            }
            
            li.oncontextmenu = (e) => {
                e.preventDefault();
                if (confirm(`Are you sure you want to delete ALL instances of ${item.name} from the script?`)) {
                    nodesList.forEach(n => {
                        if (type === 'characters') {
                            let next = n.nextElementSibling;
                            while(next && next.classList.contains('parenthetical')) {
                                let p = next;
                                next = next.nextElementSibling;
                                p.remove();
                            }
                            if (next && next.classList.contains('dialogue')) next.remove();
                        }
                        n.remove();
                    });
                    if (activeHighlights.has(item.id)) toggleHighlight(item, li, false);
                    extractEntities();
                    updateStatistics();
                    saveState();
                }
            };
            
            li.onclick = (e) => {
                if (e.target.tagName !== 'BUTTON') {
                    const arrow = left.querySelector('.toggle-arrow');
                    if (childrenUl.style.display === 'none') {
                        childrenUl.style.display = 'block';
                        arrow.innerText = '▼';
                        toggleHighlight(item, li, true);
                    } else {
                        childrenUl.style.display = 'none';
                        arrow.innerText = '▶';
                        toggleHighlight(item, li, false);
                    }
                }
            };
            
            liContainer.appendChild(li);
            liContainer.appendChild(childrenUl);
            return liContainer;
        }

        function insertBlockAtCursor(type, name) {
            let targetClass = type === 'characters' ? 'character' : 'scene-heading';
            
            let block1 = document.createElement('div');
            block1.className = targetClass;
            block1.innerText = name;
            
            let block2 = null;
            if (type === 'characters') {
                block2 = document.createElement('div');
                block2.className = 'dialogue';
                block2.innerText = ' '; // spacer for cursor
            } else {
                block2 = document.createElement('div');
                block2.className = 'action';
                block2.innerText = ' ';
            }
            
            const selection = window.getSelection();
            const editor = document.getElementById('editor-page');
            
            let node = selection.anchorNode;
            let isInside = false;
            while (node && node.id !== 'editor-page') {
                if (node.parentNode && node.parentNode.id === 'editor-page') {
                    isInside = true;
                    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
                    break;
                }
                node = node.parentNode;
            }
            
            if (isInside && node) {
                editor.insertBefore(block1, node.nextSibling);
                editor.insertBefore(block2, block1.nextSibling);
            } else {
                editor.appendChild(block1);
                editor.appendChild(block2);
            }
            
            const range = document.createRange();
            range.selectNodeContents(block2);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
            
            block2.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            extractEntities();
            saveState();
        }

        function addListItem(type) {
            const nameInput = type === 'characters' ? document.getElementById('new-char-name') : document.getElementById('new-loc-name');
            const colorInput = type === 'characters' ? document.getElementById('new-char-color') : document.getElementById('new-loc-color');
            
            const name = nameInput.value.trim().toUpperCase();
            if (!name) return;
            
            if (!appState[type].find(i => i.name === name)) {
                appState[type].push({
                    id: Date.now() + Math.random(),
                    name: name,
                    color: colorInput.value
                });
            }
            
            nameInput.value = '';
            extractEntities(); 
            saveState();
        }

        // --- CSS Custom Highlight ---
        function toggleHighlight(item, liElement, forceOn) {
            if (!window.CSS || !CSS.highlights) return;
            
            const id = item.id;
            const hlName = "hl-" + id.toString().replace('.', '-');
            
            if (!forceOn && activeHighlights.has(id)) {
                if (CSS.highlights.has(hlName)) CSS.highlights.delete(hlName);
                activeHighlights.delete(id);
                liElement.classList.remove('highlighted');
                liElement.style.borderLeftColor = 'transparent';
                return;
            }
            
            activeHighlights.add(id);
            liElement.classList.add('highlighted');
            liElement.style.borderLeftColor = item.color;
            
            if (!document.getElementById("style-" + hlName)) {
                const style = document.createElement('style');
                style.id = "style-" + hlName;
                style.innerHTML = `::highlight(${hlName}) { background-color: ${item.color}; color: #fff; }`;
                document.head.appendChild(style);
            }
            
            const editor = document.getElementById('editor-page');
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const ranges = [];
            
            const safeName = item.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            const regex = new RegExp(`\\b${safeName}\\b`, 'gi');
            
            while ((node = walker.nextNode())) {
                let match;
                const text = node.nodeValue;
                while ((match = regex.exec(text)) !== null) {
                    const range = new Range();
                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + match[0].length);
                    ranges.push(range);
                }
            }
            
            if (ranges.length > 0) {
                const highlight = new Highlight(...ranges);
                CSS.highlights.set(hlName, highlight);
            }
        }

        // --- Undo/Redo State ---
        let historyStack = [];
        let historyIndex = -1;
        let isUndoRedo = false;
        
        function saveState() {
            if (isUndoRedo) return;
            const editor = document.getElementById('editor-page');
            
            // Temporarily remove page numbers before saving DOM state
            const pn = document.getElementById('page-numbers-container');
            const pnHtml = pn ? pn.outerHTML : '';
            if (pn) pn.innerHTML = '';
            
            const content = editor.innerHTML;
            
            if (pnHtml) {
                if(pn) pn.outerHTML = pnHtml;
            }
            
            if (historyIndex >= 0 && historyStack[historyIndex] === content) return;
            
            if (historyIndex < historyStack.length - 1) {
                historyStack = historyStack.slice(0, historyIndex + 1);
            }
            historyStack.push(content);
            historyIndex++;
            if (historyStack.length > 50) { historyStack.shift(); historyIndex--; }
        }
        
        function undo() {
            if (historyIndex > 0) {
                isUndoRedo = true;
                historyIndex--;
                document.getElementById('editor-page').innerHTML = historyStack[historyIndex];
                buildToc();
                extractEntities();
                refreshAllHighlights();
                isUndoRedo = false;
            }
        }
        
        function redo() {
            if (historyIndex < historyStack.length - 1) {
                isUndoRedo = true;
                historyIndex++;
                document.getElementById('editor-page').innerHTML = historyStack[historyIndex];
                buildToc();
                extractEntities();
                refreshAllHighlights();
                isUndoRedo = false;
            }
        }
        
        function refreshAllHighlights() {
            if (!window.CSS || !CSS.highlights) return;
            const currentlyActive = Array.from(activeHighlights);
            currentlyActive.forEach(id => {
                let item = appState.characters.find(c => c.id === id) || appState.locations.find(l => l.id === id);
                if (item) {
                    const hlName = "hl-" + id.toString().replace('.', '-');
                    if (CSS.highlights.has(hlName)) CSS.highlights.delete(hlName);
                    activeHighlights.delete(id);
                    const li = document.querySelector(`.list-item-color[style*="${item.color}"]`);
                    if (li) toggleHighlight(item, li.parentNode.parentNode.parentNode, true);
                }
            });
        }

        
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

        // --- Layout Controls & Pagination ---
        function updateZoom() {
            const val = document.getElementById('zoom-slider').value;
            document.getElementById('zoom-val').innerText = val;
            document.getElementById('editor-page').style.zoom = val / 100;
        }

        function togglePageBreaks() {
            const show = document.getElementById('page-breaks-toggle').checked;
            const page = document.getElementById('editor-page');
            if (show) {
                page.classList.add('show-breaks');
                document.getElementById('page-numbers-container').style.display = 'block';
            } else {
                page.classList.remove('show-breaks');
                document.getElementById('page-numbers-container').style.display = 'none';
            }
        }

        function drawPageNumbers() {
            let container = document.getElementById('page-numbers-container');
            if (!container) return;
            container.innerHTML = '';
            
            const pageHeight = document.getElementById('editor-page').scrollHeight;
            const pixelsPerInch = 96; 
            const pageInches = 11;
            const pixelsPerPage = pixelsPerInch * pageInches;
            
            const numPages = Math.max(1, Math.ceil(pageHeight / pixelsPerPage));
            
            for (let i = 1; i <= numPages; i++) {
                const num = document.createElement('div');
                num.className = 'page-number-display';
                num.innerText = i + '.';
                // Position at the top right of each 11-inch block, with 0.5in top margin offset
                num.style.top = ((i - 1) * pixelsPerPage + 48) + 'px'; 
                container.appendChild(num);
            }
        }

        // Resizers
        function setupResizer(resizerId, targetId, isRight) {
            const resizer = document.getElementById(resizerId);
            const target = document.getElementById(targetId);
            let resizing = false;
            resizer.addEventListener('mousedown', (e) => {
                resizing = true;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!resizing) return;
                let newWidth;
                if (isRight) {
                    newWidth = document.body.clientWidth - e.clientX;
                } else {
                    newWidth = e.clientX;
                }
                newWidth = Math.max(150, Math.min(500, newWidth));
                target.style.width = newWidth + 'px';
            });
            document.addEventListener('mouseup', () => {
                resizing = false;
                document.body.style.cursor = '';
            });
        }
        setupResizer('left-resizer', 'sidebar', false);
        setupResizer('right-resizer', 'right-sidebar', true);
        
        function toggleSection(headerEl) { headerEl.classList.toggle('collapsed'); }

        // --- Formatting & TOC ---
        function formatBlock(className) {
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            
            let node = selection.anchorNode;
            while (node && node.parentNode && node.parentNode.id !== 'editor-page' && node.id !== 'editor-page') {
                node = node.parentNode;
            }
            
            if (node && node.parentNode && node.parentNode.id === 'editor-page') {
                node.className = className;
                buildToc();
                extractEntities();
                updateStatistics();
                saveState();
            } else if (node && node.id === 'editor-page') {
                document.execCommand('formatBlock', false, 'DIV');
                const divs = node.querySelectorAll('div:not([class]):not(#page-numbers-container)');
                divs.forEach(d => d.className = className);
                saveState();
            }
        }
        
        
        function paginateSimulated() {
            const editor = document.getElementById('editor-page');
            const PAGE_HEIGHT = 1056; // 11in
            const BOTTOM_MARGIN = 96; // 1in
            const TOP_MARGIN = 96; // 1in
            
            let children = Array.from(editor.children);
            for (let i = 0; i < children.length; i++) {
                let child = children[i];
                if (child.id === 'page-numbers-container') continue;
                
                // Reset any previously applied pagination margin
                if (child.dataset.pageMargin) {
                    child.style.marginTop = child.dataset.originalMargin || '';
                    delete child.dataset.pageMargin;
                    delete child.dataset.originalMargin;
                }
            }
            
            for (let i = 0; i < children.length; i++) {
                let child = children[i];
                if (child.id === 'page-numbers-container') continue;
                
                let topOffset = child.offsetTop; // Relative to offsetParent (editor)
                let pageNum = Math.floor(topOffset / PAGE_HEIGHT);
                let pageBottom = (pageNum + 1) * PAGE_HEIGHT - BOTTOM_MARGIN;
                
                if (topOffset + child.offsetHeight > pageBottom) {
                    let originalMargin = window.getComputedStyle(child).marginTop;
                    child.dataset.originalMargin = originalMargin;
                    
                    let pushAmount = (pageNum + 1) * PAGE_HEIGHT + TOP_MARGIN - topOffset + parseFloat(originalMargin);
                    child.style.marginTop = pushAmount + 'px';
                    child.dataset.pageMargin = "true";
                }
            }
        }

        let debounceTimer;
        function handleInput() {
            paginateSimulated();
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                buildToc(); 
                extractEntities();
                updateStatistics();
                saveState();
                refreshAllHighlights();
            }, 1000);
        }
        
        let draggedSceneId = null;

        function buildToc() {
            const editor = document.getElementById('editor-page');
            const tocList = document.getElementById('toc-list');
            tocList.innerHTML = '';
            
            const headings = editor.querySelectorAll('.scene-heading');
            headings.forEach((heading, idx) => {
                if (!heading.id) heading.id = 'scene-' + Date.now() + '-' + idx;
                
                const li = document.createElement('li');
                li.draggable = true;
                li.dataset.sceneId = heading.id;
                
                li.addEventListener('dragstart', (e) => {
                    draggedSceneId = heading.id;
                    e.dataTransfer.effectAllowed = 'move';
                    li.style.opacity = '0.4';
                });
                li.addEventListener('dragend', () => {
                    li.style.opacity = '1';
                    draggedSceneId = null;
                });
                li.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    li.style.borderTop = '2px solid var(--accent-color)';
                });
                li.addEventListener('dragleave', () => {
                    li.style.borderTop = '';
                });
                li.addEventListener('drop', (e) => {
                    e.preventDefault();
                    li.style.borderTop = '';
                    if (draggedSceneId && draggedSceneId !== heading.id) {
                        moveScene(draggedSceneId, heading.id);
                    }
                });

                const a = document.createElement('a');
                a.innerText = heading.innerText || "EMPTY SCENE";
                a.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                
                li.appendChild(a);
                tocList.appendChild(li);
            });
        }
        
        function moveScene(sourceId, targetId) {
            const editor = document.getElementById('editor-page');
            const sourceHeading = document.getElementById(sourceId);
            const targetHeading = document.getElementById(targetId);
            
            if (!sourceHeading || !targetHeading) return;
            
            const nodesToMove = [sourceHeading];
            let curr = sourceHeading.nextElementSibling;
            while (curr && !curr.classList.contains('scene-heading') && curr.id !== 'page-numbers-container') {
                nodesToMove.push(curr);
                curr = curr.nextElementSibling;
            }
            
            nodesToMove.forEach(node => {
                editor.insertBefore(node, targetHeading);
            });
            
            saveState();
            buildToc();
            refreshAllHighlights();
            
            document.getElementById(sourceId).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // --- Export / Import ---
        function downloadFile(filename, content, mimeType) {
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        function exportTXT() {
            const editor = document.getElementById('editor-page');
            const lines = [];
            for (let child of editor.children) {
                if (child.id === 'page-numbers-container') continue;
                if (child.classList.contains('center-title')) lines.push("          " + child.innerText + "\n");
                else if (child.classList.contains('scene-heading') || child.classList.contains('transition')) lines.push("\n" + child.innerText + "\n");
                else if (child.classList.contains('action')) lines.push(child.innerText + "\n");
                else if (child.classList.contains('character')) lines.push("\n          " + child.innerText);
                else if (child.classList.contains('parenthetical')) lines.push("        " + child.innerText);
                else if (child.classList.contains('dialogue')) lines.push("      " + child.innerText);
            }
            downloadFile('script.txt', lines.join("\n"), 'text/plain');
        }
        
        function exportMD() {
            const editor = document.getElementById('editor-page');
            const lines = [];
            for (let child of editor.children) {
                if (child.id === 'page-numbers-container') continue;
                if (child.classList.contains('scene-heading')) lines.push("**" + child.innerText + "**\n");
                else if (child.classList.contains('character')) lines.push("\n**" + child.innerText + "**");
                else if (child.classList.contains('parenthetical')) lines.push("*" + child.innerText + "*");
                else lines.push(child.innerText + "\n");
            }
            downloadFile('script.md', lines.join("\n"), 'text/markdown');
        }

        function saveJSON() {
            const editor = document.getElementById('editor-page');
            const data = [];
            for (let child of editor.children) {
                if (child.id === 'page-numbers-container') continue;
                if(child.className) {
                    data.push({ type: child.className, text: child.innerText });
                }
            }
            const exportData = {
                script: data,
                lists: appState
            };
            downloadFile('script.json', JSON.stringify(exportData, null, 2), 'application/json');
        }

                async function loadFile(event) {
            const file = event.target.files[0];
            if (!file) return;
            const editor = document.getElementById('editor-page');
            
            if (file.name.toLowerCase().endsWith('.pdf')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    
                    let pn = document.getElementById('page-numbers-container');
                    if (!pn) {
                        pn = document.createElement('div');
                        pn.id = 'page-numbers-container';
                        pn.contentEditable = "false";
                    }
                    editor.innerHTML = '';
                    editor.appendChild(pn);
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        
                        let lastY = -1;
                        let textLines = [];
                        let currentLine = { str: "", x: 0, y: 0 };
                        
                        const items = textContent.items.sort((a, b) => {
                            if (Math.abs(a.transform[5] - b.transform[5]) > 5) {
                                return b.transform[5] - a.transform[5];
                            }
                            return a.transform[4] - b.transform[4];
                        });

                        items.forEach(item => {
                            if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                                textLines.push(currentLine);
                                currentLine = { str: item.str, x: item.transform[4], y: item.transform[5] };
                            } else {
                                if (currentLine.str === "") {
                                    currentLine.x = item.transform[4];
                                    currentLine.y = item.transform[5];
                                }
                                currentLine.str += (currentLine.str.length > 0 && !currentLine.str.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
                            }
                            lastY = item.transform[5];
                        });
                        if (currentLine.str) textLines.push(currentLine);
                        
                        let prevY = -1;
                        textLines.forEach(lineTextObj => {
                            const trimmed = lineTextObj.str.trim();
                            if (!trimmed) return;
                            const x = lineTextObj.x;
                            const y = lineTextObj.y;
                            
                            const div = document.createElement('div');
                            
                            if (prevY !== -1) {
                                const yDiff = Math.abs(prevY - y);
                                if (yDiff > 24) { 
                                    div.style.marginTop = (yDiff - 14) + 'px';
                                }
                            }
                            prevY = y;
                            
                            if (i === 1 && Math.abs(x - (8.5*72)/2) < 150 && trimmed.toUpperCase() !== trimmed) {
                                div.className = 'cover-title';
                                div.style.textAlign = 'center';
                                div.style.width = '100%';
                                div.style.marginLeft = '-1in';
                            } else if (x > 350) {
                                div.className = 'transition';
                            } else if (x > 240 && trimmed === trimmed.toUpperCase() && !trimmed.includes('.') && !trimmed.includes(',')) {
                                div.className = 'character';
                            } else if (x > 200 && trimmed.startsWith('(')) {
                                div.className = 'parenthetical';
                            } else if (x > 140 && x <= 200) {
                                div.className = 'dialogue';
                            } else if (trimmed === trimmed.toUpperCase() && (trimmed.startsWith('INT.') || trimmed.startsWith('EXT.') || trimmed.startsWith('I/E.') || trimmed.startsWith('INT/EXT.'))) {
                                div.className = 'scene-heading';
                            } else {
                                div.className = 'action';
                            }
                            div.innerText = trimmed;
                            editor.appendChild(div);
                        });
                    }
                    if (typeof paginateSimulated === 'function') paginateSimulated();
                    buildToc();
                    extractEntities();
                    updateStatistics();
                    saveState();
                } catch (err) {
                    console.error(err);
                    alert("Error loading PDF file.");
                }
                event.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                const contents = e.target.result;
                const editor = document.getElementById('editor-page');
                
                // Keep the page numbers container
                let pn = document.getElementById('page-numbers-container');
                if (!pn) {
                    pn = document.createElement('div');
                    pn.id = 'page-numbers-container';
                    pn.contentEditable = "false";
                }
                editor.innerHTML = '';
                editor.appendChild(pn);
                
                if (file.name.endsWith('.json')) {
                    try {
                        const data = JSON.parse(contents);
                        const scriptData = data.script ? data.script : data;
                        if (data.lists) {
                            appState = data.lists;
                        } else {
                            appState = { characters: [], locations: [] };
                        }
                        
                        scriptData.forEach(item => {
                            const div = document.createElement('div');
                            div.className = item.type;
                            div.innerText = item.text;
                            editor.appendChild(div);
                        });
                        if (typeof paginateSimulated === 'function') paginateSimulated();
                        buildToc();
                        extractEntities();
                        updateStatistics();
                        saveState();
                    } catch (err) { alert("Invalid JSON format."); }
                } else {
                    const block = document.createElement('div');
                    block.className = 'action';
                    block.innerHTML = contents.replace(/\n/g, '<br>');
                    editor.appendChild(block);
                    if (typeof paginateSimulated === 'function') paginateSimulated();
                    buildToc();
                    extractEntities();
                    updateStatistics();
                    saveState();
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        }

        // --- Keyboard Shortcuts ---
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); } 
            else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
        });

        document.getElementById('editor-page').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                setTimeout(() => { buildToc(); extractEntities(); }, 10);
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                let node = selection.anchorNode;
                while (node && node.parentNode && node.parentNode.id !== 'editor-page' && node.id !== 'editor-page') node = node.parentNode;
                
                if (node && node.parentNode && node.parentNode.id === 'editor-page') {
                    const currentClass = node.className;
                    if (currentClass === 'action') node.className = 'character';
                    else if (currentClass === 'character') node.className = 'parenthetical';
                    else if (currentClass === 'parenthetical') node.className = 'dialogue';
                    else if (currentClass === 'dialogue') node.className = 'action';
                    else node.className = 'action';
                    
                    saveState();
                    extractEntities();
                }
            }
        });

        window.onload = () => {
            togglePageBreaks(); // Ensure page numbers display correctly if toggle is on
            extractEntities(); 
            saveState(); 
            buildToc();
            updateStatistics();
        };
    