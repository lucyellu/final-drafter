import re

with open('empty.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix broken classList checks
content = content.replace("node.!node.classList.contains('page')", "!node.classList.contains('page')")
content = content.replace("node.parentNode.!node.classList.contains('page')", "!node.parentNode.classList.contains('page')")
content = content.replace("node.classList.contains('page')", "(node.classList && node.classList.contains('page'))")
content = content.replace("node.parentNode.classList.contains('page')", "(node.parentNode.classList && node.parentNode.classList.contains('page'))")
# Fix double wrappers if any
content = content.replace("!node.parentNode.(node.parentNode.classList && node.parentNode.classList.contains('page'))", "!(node.parentNode.classList && node.parentNode.classList.contains('page'))")
content = content.replace("!node.(node.classList && node.classList.contains('page'))", "!(node.classList && node.classList.contains('page'))")
# Clean up any leftover mess
content = re.sub(r'node\.!\(node\.classList && node\.classList\.contains\(\'page\'\)\)', "!(node.classList && node.classList.contains('page'))", content)

# Wait, let's just do it cleanly via regex
with open('empty.html', 'r', encoding='utf-8') as f:
    content2 = f.read()

content2 = content2.replace("node.!node.classList.contains('page')", "!(node.classList && node.classList.contains('page'))")
content2 = content2.replace("node.parentNode.!node.classList.contains('page')", "!(node.parentNode.classList && node.parentNode.classList.contains('page'))")

# Also fix the previous replace that did node && node.classList && !node.classList.contains('page')
# Let's just run it
with open('empty.html', 'w', encoding='utf-8') as f:
    f.write(content2)
