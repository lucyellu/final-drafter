import re

with open('empty.html', 'r', encoding='utf-8') as f:
    content = f.read()

pdf_handler = """        async function loadFile(event) {
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
                    saveState();
                } catch (err) {
                    console.error(err);
                    alert("Error loading PDF file.");
                }
                event.target.value = '';
                return;
            }
            const reader = new FileReader();"""

content = re.sub(r'function loadFile\(event\)\s*\{\s*const file = event\.target\.files\[0\];\s*if \(\!file\) return;\s*const reader = new FileReader\(\);', pdf_handler, content, flags=re.DOTALL)

with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(content)
