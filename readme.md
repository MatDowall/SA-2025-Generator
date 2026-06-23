##PROJECT NAME
SA-2025 Generator

##PURPOSE
Generate Master Builders Subcontract Agreements (2025 Version). exported in a batch or indiviually. 1 subcontract per subcontractor

##DATA INJEST FROM CSV
CSV columns mapped from acroform field names. CSV templates can be generated from the app. acroform fields from SA-2025-template.pdf as the single source of truth for field names.
pages 1 - 10 of the PDF are the only feilds that will be filled with data, remaining pages are boilerplate with only initial fields bottom right.

##ARCHITECTURE
Tauri desktop application. developed in the dev environment, build as a standalone .exe. utilise pdf.js for PDF rendering. sqlite for data persistence.

##LAYOUT
app split into the follwing layout: 
	-Title Bar: The top bar that displays the application name, window icon, and window controls.
	-Menu Bar: A horizontal panel, usually below the title bar, containing dropdown categories like File, Edit, and View.
	-left-hand navigation pane for subcontractor selection - resizable horizontally - default to 30% of the window width
	-main canvas for viewing PDFs - renders PDF's with vertical scroll - default to 70% of the window width
	-bottom status bar / footer - for displaying various in-app information such as layout shortcuts (page number, next page, zoom etc)
	
any app modal should use a standard API for modal layout. Modals should be movable and follow standard conventions:
	- Header: Features a concise, clear title and an explicit close action (usually an 'X' icon).
	- Body: Contains the primary content, form fields, or instructional text.
	- Footer: Holds standard action buttons. Primary actions (e.g., Save, Delete) are usually on the right, while secondary actions (e.g., Cancel) are on the left

##DATA PERSISTENCE
projects are saved in the app and can be added / deleted via the interface. users can:
	- Add a PROJECT - creates a new project, prompts user for name & project number. 
	- delete a PROJECT
	- export a PROJECT (saves as *.saproj)
	- import a PROJECT
	- modify an existing project - the project loads into the workspace with a left-hand taskbar list view of all the differnet subcontractor agreements in the project. clicking on each subcontractor in the taskbar populates an onscreen PDF SA-2025 with the relevent information related to that subcontractor, allowing viewing and modifacaiton

##IMPORT FROM CSV
CSV is laid out as columns = various form feilds, rows are per subcontractor.

##EXPORT TO CSV
entire batch of current project can be exported to CSV. user is presented with a modal specifiying which form fields to export in the CSV. page 1 - 10 only. selection is remembered on project by project basis.

##EXPORT TO PDF
Batch export or individual export. batch export zips for download. PDF naming convention is: *project_number*-*project_name*-*subcontractor*.pdf

##ROADMAP
implement all milestones as laid out below, always stop at each milestone gate and wait for user approval before proceeding to next milestone. never try to autoverify any layout. always ask the user to verify UI/UX elements.

#Milestone 1:
Layout.
Gate:
window renders with layout as described

#Milestone 2:
PDF rendering.
Gate:
SA-2025 pdf loads into the workspace, renders clearly and can be navigated / scrolled.

#Milestone 3:
create new project.
Gate:
new project can be created and persists on app reload

#Milestone 4:
Export to CSV.
Gate:
export works and CSV is populated with the correct fields as per the users selections

#Milestone 5:
Import CSV.
Gate:
same CSV can be imported and data is mapped correctly and rendered on the PDF in-app.

#Milestone 6:
Export PDF.
Gate:
PDF can be exported individually or batched to zip. user is always prompted for save location.

#Milestone 7:
data persistence / project load
Gate:
project can be exported / imported with 100% data integrity