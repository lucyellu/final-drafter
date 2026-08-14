import re

with open('empty.html', 'r', encoding='utf-8') as f:
    content = f.read()

replacement = """
                        let prevY = -1;
                        let lastDiv = null;
                        
                        textLines.forEach(lineTextObj => {
                            const trimmed = lineTextObj.str.trim();
                            if (!trimmed) return;
                            const x = lineTextObj.x;
                            const y = lineTextObj.y;
                            
                            let className = 'action';
                            if (i === 1 && Math.abs(x - (8.5*72)/2) < 150 && trimmed.toUpperCase() !== trimmed) {
                                className = 'cover-title';
                            } else if (x > 350) {
                                className = 'transition';
                            } else if (x > 240 && trimmed === trimmed.toUpperCase() && !trimmed.includes('.') && !trimmed.includes(',')) {
                                className = 'character';
                            } else if (x > 200 && trimmed.startsWith('(')) {
                                className = 'parenthetical';
                            } else if (x > 140 && x <= 200) {
                                className = 'dialogue';
                            } else if (trimmed === trimmed.toUpperCase() && (trimmed.startsWith('INT.') || trimmed.startsWith('EXT.') || trimmed.startsWith('I/E.') || trimmed.startsWith('INT/EXT.'))) {
                                className = 'scene-heading';
                            }
                            
                            let yDiff = 0;
                            if (prevY !== -1) {
                                yDiff = Math.abs(prevY - y);
                            }
                            prevY = y;
                            
                            // Group with previous div if same class and close together
                            if (lastDiv && lastDiv.className === className && yDiff < 24 && className !== 'character' && className !== 'scene-heading') {
                                lastDiv.innerHTML += '<br>' + trimmed;
                                return;
                            }
                            
                            const div = document.createElement('div');
                            if (yDiff > 24) { 
                                div.style.marginTop = (yDiff - 14) + 'px';
                            }
                            
                            div.className = className;
                            div.innerText = trimmed;
                            if (className === 'cover-title') {
                                div.style.textAlign = 'center';
                                div.style.width = '100%';
                                div.style.marginLeft = '-1in';
                            }
                            editor.appendChild(div);
                            lastDiv = div;
                        });
"""

# The regex should match the inner loop
regex = re.compile(r'let prevY = -1;\s*textLines\.forEach\(lineTextObj => \{.*?editor\.appendChild\(div\);\s*\}\);', re.DOTALL)
content = regex.sub(replacement, content)

with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(content)
