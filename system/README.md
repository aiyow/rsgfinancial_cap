# RSG Condo User Manual

The HTML file is the canonical manual content. Word and PDF are generated copies.

The manual includes four visual workflows: monthly handoffs, billing preparation, receipt approval and billing correction. Diagram text and drawing code live in `build_user_manual.py`; generated images are kept in `manual_assets/` so the HTML works without a server.

## Regenerate on Windows

The generator requires Microsoft Word plus Python with `python-docx`, `Pillow` and `lxml`. It defaults to the Codex bundled Python when available. From the project root:

```powershell
./system/generate_user_manual.ps1
```

To use another compatible Python installation:

```powershell
./system/generate_user_manual.ps1 -PythonExecutable 'C:/path/to/python.exe'
```

`-SourceHtml`, `-OutputDocx` and `-OutputPdf` select review copies without replacing the normal outputs. The Python builder creates the diagrams and editable Word styles; Word updates page fields and exports the PDF with heading bookmarks. Keep the HTML and the `manual_assets` folder together.

After content or layout changes, check all PDF pages for readable diagrams, complete tables and clean page breaks. Check the task-index links and confirm roles and button names against the frontend. User instructions should describe the implemented workflow, including error and rejection paths.
