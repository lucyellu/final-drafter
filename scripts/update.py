import re

with open('empty.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. CSS Updates
css_wrapper = """        #editor-wrapper {
            flex-grow: 1;
            overflow-y: auto;
            background-color: #2b2b2b;
            padding: 40px 20px;
            scroll-behavior: smooth;
            position: relative;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            align-content: flex-start;
            gap: 40px;
        }"""
content = re.sub(r'\s*#editor-wrapper\s*\{[^}]*\}', '\n' + css_wrapper, content)

css_page = """        .page {
            margin: 0;
            background-color: var(--page-bg);
            color: var(--page-text);
            width: 8.5in;
            height: 11in; 
            padding: 1in 1in 1in 1.5in;
            box-sizing: border-box;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            font-family: 'Courier Prime', 'Courier New', Courier, monospace;
            font-size: 12pt;
            line-height: 1.1;
            outline: none; 
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
            transform-origin: top left;
        }"""
content = re.sub(r'\s*\.page\s*\{[^}]*\}', '\n' + css_page, content)

# 2. HTML Updates
html_wrapper = """        <div id="editor-wrapper">
            <div class="page" contenteditable="true" oninput="handleInput()">
            </div>
        </div>"""
content = re.sub(r'\s*<div id="editor-wrapper">.*?</div>\s*</div>', '\n' + html_wrapper, content, flags=re.DOTALL)

# 3. JS Updates
# Instead of id="editor-page", use classes or wrapper
content = content.replace("document.getElementById('editor-page')", "document.getElementById('editor-wrapper')")
content = content.replace("id !== 'editor-page'", "!node.classList.contains('page')")
content = content.replace("id === 'editor-page'", "classList.contains('page')")

# Export/Save loops need to iterate over all script elements
content = content.replace("for (let child of editor.children) {", "for (let child of document.querySelectorAll('.page > div')) {")
content = content.replace("if (child.id === 'page-numbers-container') continue;", "")

# Zoom
content = content.replace("document.getElementById('editor-wrapper').style.zoom = val / 100;", "document.querySelectorAll('.page').forEach(p => p.style.zoom = val / 100);")
content = content.replace("document.getElementById('zoom-slider').value / 100", "document.getElementById('zoom-slider').value / 100")

# togglePageBreaks is obsolete, simplify or remove
content = re.sub(r'function togglePageBreaks\(\)\s*\{.*?\}', 'function togglePageBreaks() {}', content, flags=re.DOTALL)
content = re.sub(r'function drawPageNumbers\(\)\s*\{.*?\}', 'function drawPageNumbers() {}', content, flags=re.DOTALL)

# loadFile PDF handler
pdf_handler = """
            if (file.name.toLowerCase().endsWith('.pdf')) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    
                    const wrapper = document.getElementById('editor-wrapper');
                    wrapper.innerHTML = '';
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        
                        const pageDiv = document.createElement('div');
                        pageDiv.className = 'page';
                        pageDiv.contentEditable = 'true';
                        pageDiv.oninput = handleInput;
                        pageDiv.style.zoom = document.getElementById('zoom-slider').value / 100;
                        
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
                            pageDiv.appendChild(div);
                        });
                        wrapper.appendChild(pageDiv);
                    }
                    buildToc();
                    extractEntities();
                    saveState();
                } catch (err) {
                    console.error(err);
                    alert("Error loading PDF file.");
                }
                event.target.value = '';
                return;
            }
"""

content = re.sub(r'if \(file\.name\.toLowerCase\(\)\.endsWith\(\'\.pdf\'\)\) \{.*?(?=const reader = new FileReader\(\);)', pdf_handler, content, flags=re.DOTALL)

# JSON / Text loader updates
content = re.sub(r'let pn = document\.getElementById.*?editor\.appendChild\(pn\);', 
                 "editor.innerHTML = '<div class=\"page\" contenteditable=\"true\" oninput=\"handleInput()\"></div>'; const page = editor.querySelector('.page'); page.style.zoom = document.getElementById('zoom-slider').value / 100;", content, flags=re.DOTALL)
content = content.replace('editor.appendChild(div);', 'page.appendChild(div);')
content = content.replace('editor.appendChild(block);', 'page.appendChild(block);')

# Add paginate function
paginate_func = """        function paginate() {
            const wrapper = document.getElementById('editor-wrapper');
            const pages = Array.from(wrapper.querySelectorAll('.page'));
            let modified = false;

            for (let i = 0; i < pages.length; i++) {
                let page = pages[i];
                
                // Push overflowing blocks to next page
                while (page.scrollHeight > page.clientHeight && page.children.length > 1) {
                    let next = pages[i + 1];
                    if (!next) {
                        next = document.createElement('div');
                        next.className = 'page';
                        next.contentEditable = 'true';
                        next.oninput = handleInput;
                        next.style.zoom = document.getElementById('zoom-slider').value / 100;
                        wrapper.appendChild(next);
                        pages.push(next);
                    }
                    next.insertBefore(page.lastElementChild, next.firstElementChild);
                    modified = true;
                }
                
                // Pull blocks from next page if there is room
                let next = pages[i + 1];
                if (next) {
                    while (next.children.length > 0) {
                        let firstChild = next.firstElementChild;
                        page.appendChild(firstChild);
                        if (page.scrollHeight > page.clientHeight) {
                            next.insertBefore(page.lastElementChild, next.firstElementChild);
                            break;
                        }
                        modified = true;
                    }
                    if (next.children.length === 0) {
                        next.remove();
                        pages.splice(i + 1, 1);
                    }
                }
            }
            if (modified) {
                buildToc();
                saveState();
            }
        }
"""
content = content.replace('function handleInput() {', paginate_func + '\n        function handleInput() {')
content = content.replace('clearTimeout(debounceTimer);', 'paginate(); clearTimeout(debounceTimer);')
content = content.replace('const divs = node.querySelectorAll', 'const divs = document.getElementById("editor-wrapper").querySelectorAll')

# Fix node.classList checking in handleInput and others
content = content.replace("node && !node.classList.contains('page')", "node && node.classList && !node.classList.contains('page')")
content = content.replace("node && node.classList.contains('page')", "node && node.classList && node.classList.contains('page')")

with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(content)
