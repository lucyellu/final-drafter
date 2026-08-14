import re

with open('empty.html', 'r', encoding='utf-8') as f:
    content = f.read()

paginate = """
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
"""

content = content.replace("let debounceTimer;", paginate + "\n        let debounceTimer;")
content = content.replace("clearTimeout(debounceTimer);", "paginateSimulated();\n            clearTimeout(debounceTimer);")

with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(content)
