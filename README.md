This is a tool like website for all the people who want to know about big projects, codebases, etc.
Just upload any project folder and it analysis it and gives you a complete info for the folder and for each file.
it gives:
1. Project Health: which shows about how well is the documentation, structure, dependencies, complexity, etc;,
2. starting: From which file or inner folder to start, means like if it is about a frontend or a website code folder then the starting point will be main html file.
3. Architecture: it is like a blueprint where which shows what is the content of folders like which file does the folder has, etc. example:
├─ PAGE (127)
── stardance-main/stardance-main/db/migrate — 40 files
── stardance-main/stardance-main/app/assets/stylesheets/pages/shop — 16 files
── stardance-main/stardance-main/app/assets/stylesheets/pages/admin — 15 files
── stardance-main/stardance-main/app/assets/stylesheets/pages — 12 files
── stardance-main/stardance-main/app/assets/stylesheets/pages/certification — 5 files
── stardance-main/stardance-main/app/assets/stylesheets/pages/projects — 5 files
├─ COMPONENT (101)
── stardance-main/stardance-main/app/assets/stylesheets/components — 52 files
── stardance-main/stardance-main/app/components — 20 files
── stardance-main/stardance-main/app/components/discover_rail — 18 files
── stardance-main/stardance-main/app/components/onboarding — 3 files
── stardance-main/stardance-main/app/components/posts — 2 files
── stardance-main/stardance-main/app/components/admin/certification — 1 file

4. Manifests and Docs: something like this:
✓
package.json
○
requirements.txt
○
pyproject.toml
○
Cargo.toml
○
go.mod
○
pom.xml
○
composer.json
✓
Gemfile
✓
Dockerfile
○
Makefile
○
tsconfig.json
○
vite.config.js
○
webpack.config.js
○
.gitignore
✓
readme_image_controller.js — documentation found

5. Graph: it is like a detailed blue print which shows the connection between each file even if it is in secondary folder; it analysis the data of each file and identifies the connection and then in a way of graph it shows that, for example:
   <img width="1376" height="756" alt="Screenshot 2026-09-29 at 3 15 26 PM" src="https://github.com/user-attachments/assets/f14ea584-4f5a-4b7c-86a3-d7141fe1e82d" />

6. Warnings: It gives warnings for files like if they are very long or huge file.
7. History: it shows the history of any folder means it shows the name of the branch, number of commits parsed, oldest commit and latest commit, and all the commits in a way of timeline,(this photo is from lenovo laptop, as my macbook is new I don't know how to turn view hidden files on, so in macbook it could be like it shows no .git file found) example:
   <img width="1252" height="642" alt="WhatsApp Image 2026-09-29 at 3 38 08 PM" src="https://github.com/user-attachments/assets/d00d1076-2c8c-453b-bd7d-a8865a5411d6" />

8. Export report: you can export a report which will have all the things written in qa rpport (text file).
9. New project: Liked using DEVLENS? then you can use it again for another folder by clicking on this button.

I had tested this website on stardance's project folder which I got from github, so here is that testing results:



https://github.com/user-attachments/assets/ed8f7460-2580-45fe-9d5f-4ed99b348450

