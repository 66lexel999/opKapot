# opKapot Uninstaller

An advanced uninstaller and disk cleaner for Windows, inspired by IObit Uninstaller. It removes programs and Windows apps in bulk, wipes the leftovers they leave behind, finds large and duplicate files, and cleans junk, all from a dark sidebar UI.

![Bundleware view](docs/screenshots/bundleware.png)

## Features

### Programs
- **All Programs**, **Bundleware**, **Recently Installed**, **Large Programs** and **Infrequently Used** views.
- Sort any column (name, size, install date, version, last used). Search by name or publisher.
- **Batch uninstall**: tick as many programs as you like and remove them in one go.
- **Bundleware detection** finds programs installed together with another one. It links programs that share a publisher, were installed at the same moment, or sit inside another program's folder.
- **Infrequently Used** uses Windows Prefetch launch data to show programs you haven't opened in 60+ days.
- Right-click menu: Uninstall, **Force remove** (for broken uninstallers), open the install folder, search online, and Properties (registry key, uninstall command and more).

### Uninstall wizard
1. Optional **System Restore point** before anything changes.
2. Runs each uninstaller in turn. Optional **silent mode** covers MSI, Inno Setup and `QuietUninstallString`.
3. Waits for uninstallers that hand off to helper processes (Inno Setup and NSIS copy themselves to `%TEMP%`), with a **Skip waiting** button.
4. **Leftover scan** finds matching folders in Program Files, ProgramData and AppData, Start menu and desktop shortcuts, and registry keys under `HKCU/HKLM\Software`.
5. You review the leftovers before anything is deleted. Exact matches are pre-ticked; shared-looking items are marked **Review**. Registry keys are exported to a `.reg` backup before they are deleted.

### Windows Apps
- Lists Microsoft Store and pre-installed apps (AppX) with their size, and removes several at once. System-critical apps are hidden.

### Files
- **All Files**: recursive scan of any drive or folder with filters for size, type (video, audio, pictures, documents, archives, installers…) and age. Results are sortable and can be deleted in bulk.
- **Large Files**: the same scanner, pre-set to find big files on your system drive.
- **Duplicate Files**: compares file contents (size, then a partial hash, then a full SHA-1). **Auto-select** can keep the newest, oldest or shortest-path copy. The app never deletes every copy of a file.
- **Space Analyzer**: shows how much space each folder uses, with share bars. Double-click a folder to drill down.
- Scans run in a background thread, the tables are virtualised (hundreds of thousands of rows stay smooth), and you can stop a scan at any time and keep the partial results.

### Junk Cleaner
Covers user and Windows temp files, the Windows Update cache, error reports and crash dumps, browser caches (Chrome, Edge, Brave, Vivaldi, Opera, Firefox), DirectX/GPU shader caches, thumbnail cache, Delivery Optimization files, old logs, Prefetch data and the Recycle Bin. Temp files newer than 24 hours (configurable) and files in use are skipped.

### Also
- **History** of everything removed and how much space it freed.
- **Settings**: Recycle Bin or permanent delete, restore points, silent mode, automatic leftover removal, system components, scan exclusions and the temp-file age limit.
- Keyboard shortcuts: `F5` refresh, `Ctrl+F` search, `Ctrl+A` select all, `Delete` uninstall or delete the selection, `Esc` close dialogs.

| | |
|---|---|
| ![All programs](docs/screenshots/all-programs.png) | ![Leftovers](docs/screenshots/uninstall-leftovers.png) |
| ![Large files](docs/screenshots/large-files.png) | ![Duplicates](docs/screenshots/duplicates.png) |
| ![Space analyzer](docs/screenshots/space-analyzer.png) | ![Windows apps](docs/screenshots/windows-apps.png) |

## Safety

Deleting things is serious, so several guards are built in:

- **Protected paths.** The app refuses to delete drive roots, `C:\Windows` (except Temp, Minidump, LiveKernelReports and the Update download cache), Program Files and ProgramData roots, your user profile folders, `pagefile.sys` and similar files. The same rule blocks deleting any folder that contains one of these.
- **Leftovers never overlap other programs.** A folder is not offered if it is, or contains, another installed program's folder. A publisher folder is only offered when no other installed program comes from that publisher.
- **Registry.** Shared keys (`Microsoft`, `Classes`, `Policies`, `Windows`, …) can never be deleted. Every deleted key is backed up to `%APPDATA%\opKapot Uninstaller\registry-backups`.
- Files go to the **Recycle Bin** by default, and every delete asks for confirmation first.

## Download and run

### Windows (recommended)
1. Download **[opKapot-Uninstaller-Portable-1.0.0.exe](release/opKapot-Uninstaller-Portable-1.0.0.exe)** (open the link, then click **Download raw file**). It's portable, so there's nothing to install.
2. Double-click it. Windows SmartScreen may say *"Windows protected your PC"* because the app isn't code-signed: click **More info → Run anyway**.
3. Click **Yes** when Windows asks for administrator permission. Uninstalling programs and cleaning Windows folders needs it.

The first launch takes a few seconds while the portable exe unpacks itself. Put the exe anywhere you like (for example your Desktop) and run it from there.

The **Build** GitHub Actions workflow also produces an installer (`opKapot-Uninstaller-Setup-x.y.z.exe`) and a fresh portable exe. Once Actions is enabled for the repository, download them from a workflow run's **Artifacts** section.

### Build from source
Requires Node.js 20+.

```bash
npm install
npm start          # run the app
npm run demo       # run with sample programs (see below)
npm test           # unit tests
npm run dist:win   # build the Windows installer + portable exe into dist/ (run on Windows)
```

### Demo mode
`npm run demo` (or `--demo`) fills **Programs** and **Windows Apps** with sample data and only simulates uninstalls, so you can try the UI safely on any OS. **Files** and **Junk Cleaner** still work on your real disk in demo mode. They always ask before deleting anything.

## Platform support
- **Windows 10/11**: full feature set. Programs are read from the registry (64-bit, 32-bit and per-user).
- **Linux**: APT, Flatpak and Snap packages; Files and Junk Cleaner.
- **macOS**: apps in `/Applications` (uninstall moves them to the Trash); Files and Junk Cleaner.

## Project layout

```
src/main/                 Electron main process
  main.js, preload.js, ipc.js
  lib/                    process helpers, path & registry safety, command-line parsing
  services/programs/      Windows registry, Linux and macOS providers, bundleware grouping, demo data
  services/leftovers.js   leftover finder
  services/junk.js        junk categories
  services/windowsApps.js AppX packages
  workers/scan-worker.js  file scans, duplicate hashing, folder sizes, junk scan/clean (worker thread)
src/renderer/             UI (plain ES modules, no framework)
  js/components/table.js  virtualised, sortable, multi-select table
  js/views/               one module per sidebar section
test/                     node:test unit tests
```
