from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QComboBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QRadioButton,
    QScrollArea,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from core import (
    ARTICLE_FIELDS,
    ARTICLE_REQUIRED,
    OPTION_FIELDS,
    OPTION_REQUIRED,
    QUESTION_FIELDS,
    QUESTION_REQUIRED,
    Issue,
    RoyalApi,
    SQLiteSource,
    SchemaMapping,
    SourceData,
    build_preview,
    validate_mapping,
    validate_source,
)

load_dotenv()

APP_TITLE = "Royal Content Manager"
LOG_DIR = Path.home() / "RoyalContentManager" / "logs"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImportWorker(QThread):
    progress = Signal(int, str)
    completed = Signal(dict)
    failed = Signal(str)

    def __init__(
        self,
        api: RoyalApi,
        data: SourceData,
        mode: str,
        pathway_id: int | None,
        bank_id: int | None,
        new_pathway_name: str,
        new_pathway_description: str,
        new_bank_name: str,
        new_bank_description: str,
    ) -> None:
        super().__init__()
        self.api = api
        self.data = data
        self.mode = mode
        self.pathway_id = pathway_id
        self.bank_id = bank_id
        self.new_pathway_name = new_pathway_name
        self.new_pathway_description = new_pathway_description
        self.new_bank_name = new_bank_name
        self.new_bank_description = new_bank_description

    def run(self) -> None:
        try:
            log: dict[str, Any] = {
                "batch_id": str(uuid.uuid4()),
                "started_at": now_iso(),
                "mode": self.mode,
                "questions": len(self.data.questions),
                "options": len(self.data.options),
                "articles": len(self.data.articles),
                "events": [],
            }
            pathway_id = self.pathway_id
            bank_id = self.bank_id
            self.progress.emit(2, "Preparing target...")

            if self.mode == "new_pathway_bank":
                pathway = self.api.create_pathway(self.new_pathway_name, self.new_pathway_description)
                pathway_id = int(pathway["id"])
                self.api.ensure_standard_plans("pathway", pathway_id)
                log["events"].append({"event": "pathway_created", "id": pathway_id})

                bank = self.api.create_bank(pathway_id, self.new_bank_name, self.new_bank_description)
                bank_id = int(bank["id"])
                self.api.ensure_standard_plans("bank", bank_id)
                log["events"].append({"event": "bank_created", "id": bank_id})

            elif self.mode == "new_bank":
                if pathway_id is None:
                    raise RuntimeError("Existing pathway is required.")
                bank = self.api.create_bank(pathway_id, self.new_bank_name, self.new_bank_description)
                bank_id = int(bank["id"])
                self.api.ensure_standard_plans("bank", bank_id)
                log["events"].append({"event": "bank_created", "id": bank_id})

            if bank_id is None:
                raise RuntimeError("Target bank is not resolved.")

            grouped_options = self.data.options_by_question
            questions_payload: list[dict[str, Any]] = []
            for question in self.data.questions:
                item = dict(question)
                item["options"] = grouped_options.get(int(question["id"]), [])
                questions_payload.append(item)

            question_batch_size = 50
            total_questions = len(questions_payload)
            for start in range(0, total_questions, question_batch_size):
                batch = questions_payload[start:start + question_batch_size]
                response = self.api.rpc("content_manager_import_questions", {
                    "p_bank_id": bank_id,
                    "p_rows": batch,
                })
                log["events"].append({"event": "question_batch", "start": start, "size": len(batch), "response": response})
                pct = 5 + int(75 * min(start + len(batch), total_questions) / max(total_questions, 1))
                self.progress.emit(pct, f"Imported questions {min(start + len(batch), total_questions):,}/{total_questions:,}")

            article_batch_size = 200
            total_articles = len(self.data.articles)
            for start in range(0, total_articles, article_batch_size):
                batch = self.data.articles[start:start + article_batch_size]
                response = self.api.rpc("content_manager_import_articles", {
                    "p_bank_id": bank_id,
                    "p_rows": batch,
                })
                log["events"].append({"event": "article_batch", "start": start, "size": len(batch), "response": response})
                pct = 80 + int(15 * min(start + len(batch), total_articles) / max(total_articles, 1))
                self.progress.emit(pct, f"Imported articles {min(start + len(batch), total_articles):,}/{total_articles:,}")

            self.progress.emit(97, "Refreshing question-bank counts...")
            refresh = self.api.rpc("content_manager_refresh_counts", {})
            log["events"].append({"event": "counts_refreshed", "response": refresh})

            log["finished_at"] = now_iso()
            log["pathway_id"] = pathway_id
            log["bank_id"] = bank_id
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            log_path = LOG_DIR / f"import-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{log['batch_id'][:8]}.json"
            log_path.write_text(json.dumps(log, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
            log["log_path"] = str(log_path)
            self.progress.emit(100, "Import completed.")
            self.completed.emit(log)
        except Exception:
            self.failed.emit(traceback.format_exc())


class MappingPanel(QFrame):
    changed = Signal()

    def __init__(self, title: str, fields: list[str], required: set[str]) -> None:
        super().__init__()
        self.fields = fields
        self.required = required
        self.table_combo = QComboBox()
        self.field_combos: dict[str, QComboBox] = {}

        layout = QVBoxLayout(self)
        title_label = QLabel(title)
        title_label.setObjectName("sectionTitle")
        layout.addWidget(title_label)

        form = QFormLayout()
        form.addRow("Source table", self.table_combo)
        for field in fields:
            combo = QComboBox()
            combo.addItem("<not mapped>", None)
            combo.currentIndexChanged.connect(self.changed)
            self.field_combos[field] = combo
            form.addRow(field + (" *" if field in required else ""), combo)
        layout.addLayout(form)
        self.table_combo.currentIndexChanged.connect(self.changed)

    def set_tables(self, tables: dict[str, list[str]], allow_none: bool = False) -> None:
        self.table_combo.blockSignals(True)
        self.table_combo.clear()
        if allow_none:
            self.table_combo.addItem("<none>", "")
        for name in tables:
            self.table_combo.addItem(name, name)
        self.table_combo.blockSignals(False)

    def set_table(self, table: str, columns: list[str], mapping: dict[str, str | None]) -> None:
        index = self.table_combo.findData(table)
        if index >= 0:
            self.table_combo.setCurrentIndex(index)
        for field, combo in self.field_combos.items():
            combo.blockSignals(True)
            combo.clear()
            combo.addItem("<not mapped>", None)
            for column in columns:
                combo.addItem(column, column)
            source = mapping.get(field)
            if source:
                position = combo.findData(source)
                if position >= 0:
                    combo.setCurrentIndex(position)
            combo.blockSignals(False)

    def read(self) -> tuple[str, dict[str, str | None]]:
        return str(self.table_combo.currentData() or ""), {field: combo.currentData() for field, combo in self.field_combos.items()}


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle(APP_TITLE)
        self.resize(1320, 860)
        self.tables: dict[str, list[str]] = {}
        self.mapping = SchemaMapping()
        self.source: SQLiteSource | None = None
        self.data: SourceData | None = None
        self.issues: list[Issue] = []
        self.api: RoyalApi | None = None
        self.preview = None
        self.pathways_cache: list[dict[str, Any]] = []
        self.worker: ImportWorker | None = None
        self._build_ui()
        self._apply_style()

    def _build_ui(self) -> None:
        shell = QWidget()
        root = QHBoxLayout(shell)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(230)
        side_layout = QVBoxLayout(sidebar)
        brand = QLabel("ROYAL\nCONTENT MANAGER")
        brand.setObjectName("brand")
        side_layout.addWidget(brand)
        self.nav = QListWidget()
        for name in ["1  Source & Mapping", "2  Validation", "3  Target", "4  Preview", "5  Import"]:
            self.nav.addItem(QListWidgetItem(name))
        self.nav.currentRowChanged.connect(lambda row: self.stack.setCurrentIndex(max(row, 0)))
        side_layout.addWidget(self.nav, 1)
        note = QLabel("Safe rule:\nMissing source content is never deleted.")
        note.setObjectName("sideNote")
        note.setWordWrap(True)
        side_layout.addWidget(note)

        self.stack = QStackedWidget()
        self.stack.addWidget(self._source_page())
        self.stack.addWidget(self._validation_page())
        self.stack.addWidget(self._target_page())
        self.stack.addWidget(self._preview_page())
        self.stack.addWidget(self._import_page())
        root.addWidget(sidebar)
        root.addWidget(self.stack, 1)
        self.setCentralWidget(shell)
        self.nav.setCurrentRow(0)

    def _page(self, title: str, subtitle: str) -> tuple[QWidget, QVBoxLayout]:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(32, 24, 32, 24)
        heading = QLabel(title)
        heading.setObjectName("pageTitle")
        description = QLabel(subtitle)
        description.setObjectName("pageSubtitle")
        description.setWordWrap(True)
        layout.addWidget(heading)
        layout.addWidget(description)
        layout.addSpacing(12)
        return page, layout

    def _source_page(self) -> QWidget:
        page, layout = self._page("Source Database", "Choose a SQLite database, scan it, then review the automatic field mapping.")
        row = QHBoxLayout()
        self.file_edit = QLineEdit()
        self.file_edit.setPlaceholderText("Choose a .db / .sqlite file")
        browse = QPushButton("Browse")
        browse.clicked.connect(self._browse)
        scan = QPushButton("Scan Database")
        scan.setObjectName("primary")
        scan.clicked.connect(self._scan)
        row.addWidget(self.file_edit, 1)
        row.addWidget(browse)
        row.addWidget(scan)
        layout.addLayout(row)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        host = QWidget()
        grid = QGridLayout(host)
        self.q_panel = MappingPanel("Questions", QUESTION_FIELDS, QUESTION_REQUIRED)
        self.o_panel = MappingPanel("Options", OPTION_FIELDS, OPTION_REQUIRED)
        self.a_panel = MappingPanel("Library Articles (optional)", ARTICLE_FIELDS, ARTICLE_REQUIRED)
        for panel in (self.q_panel, self.o_panel, self.a_panel):
            panel.changed.connect(self._mapping_changed)
        self.q_panel.table_combo.currentIndexChanged.connect(lambda: self._table_changed(self.q_panel, "question"))
        self.o_panel.table_combo.currentIndexChanged.connect(lambda: self._table_changed(self.o_panel, "option"))
        self.a_panel.table_combo.currentIndexChanged.connect(lambda: self._table_changed(self.a_panel, "article"))
        grid.addWidget(self.q_panel, 0, 0)
        grid.addWidget(self.o_panel, 0, 1)
        grid.addWidget(self.a_panel, 1, 0, 1, 2)
        scroll.setWidget(host)
        layout.addWidget(scroll, 1)
        self.scan_status = QLabel("No source scanned yet.")
        self.scan_status.setObjectName("status")
        layout.addWidget(self.scan_status)
        return page

    def _validation_page(self) -> QWidget:
        page, layout = self._page("Verification", "Import is blocked if structural or data-integrity errors are found.")
        row = QHBoxLayout()
        button = QPushButton("Run Full Verification")
        button.setObjectName("primary")
        button.clicked.connect(self._validate)
        self.validation_summary = QLabel("Not verified")
        row.addWidget(button)
        row.addWidget(self.validation_summary)
        row.addStretch(1)
        layout.addLayout(row)
        self.issue_table = QTableWidget(0, 3)
        self.issue_table.setHorizontalHeaderLabels(["Severity", "Code", "Message"])
        self.issue_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        layout.addWidget(self.issue_table, 1)
        self.counts_box = QPlainTextEdit()
        self.counts_box.setReadOnly(True)
        self.counts_box.setMaximumHeight(130)
        layout.addWidget(self.counts_box)
        return page

    def _target_page(self) -> QWidget:
        page, layout = self._page("Target Environment", "Connect with a service-role key. Use DEV first; Production requires explicit confirmation.")
        form = QFormLayout()
        self.env_combo = QComboBox()
        self.env_combo.addItems(["DEV", "PRODUCTION"])
        self.env_combo.currentTextChanged.connect(self._environment_changed)
        self.url_edit = QLineEdit()
        self.key_edit = QLineEdit()
        self.key_edit.setEchoMode(QLineEdit.Password)
        self.connect_btn = QPushButton("Connect")
        self.connect_btn.setObjectName("primary")
        self.connect_btn.clicked.connect(self._connect)
        self.conn_status = QLabel("Not connected")
        form.addRow("Environment", self.env_combo)
        form.addRow("Supabase URL", self.url_edit)
        form.addRow("Service-role key", self.key_edit)
        form.addRow(self.connect_btn, self.conn_status)
        layout.addLayout(form)

        title = QLabel("Import Mode")
        title.setObjectName("sectionTitle")
        layout.addWidget(title)
        self.mode_group = QButtonGroup(self)
        self.mode_new_pathway = QRadioButton("New Pathway + New Bank")
        self.mode_new_bank = QRadioButton("New Bank inside Existing Pathway")
        self.mode_update = QRadioButton("Update Existing Bank")
        self.mode_update.setChecked(True)
        for radio in (self.mode_new_pathway, self.mode_new_bank, self.mode_update):
            self.mode_group.addButton(radio)
            layout.addWidget(radio)
            radio.toggled.connect(self._mode_changed)

        target_form = QFormLayout()
        self.pathway_combo = QComboBox()
        self.pathway_combo.currentIndexChanged.connect(self._pathway_selected)
        self.bank_combo = QComboBox()
        self.new_pathway_name = QLineEdit()
        self.new_pathway_desc = QLineEdit()
        self.new_bank_name = QLineEdit()
        self.new_bank_desc = QLineEdit()
        self.prod_confirm = QLineEdit()
        self.prod_confirm.setPlaceholderText('Type PRODUCTION only for Production imports')
        target_form.addRow("Existing Pathway", self.pathway_combo)
        target_form.addRow("Existing Bank", self.bank_combo)
        target_form.addRow("New Pathway name", self.new_pathway_name)
        target_form.addRow("New Pathway description", self.new_pathway_desc)
        target_form.addRow("New Bank name", self.new_bank_name)
        target_form.addRow("New Bank description", self.new_bank_desc)
        target_form.addRow("Production confirmation", self.prod_confirm)
        layout.addLayout(target_form)
        layout.addStretch(1)
        self._environment_changed("DEV")
        self._mode_changed()
        return page

    def _preview_page(self) -> QWidget:
        page, layout = self._page("Preview Changes", "Compare the source with the selected target before importing.")
        button = QPushButton("Build Preview")
        button.setObjectName("primary")
        button.clicked.connect(self._build_preview)
        layout.addWidget(button, 0, Qt.AlignLeft)
        self.preview_table = QTableWidget(0, 3)
        self.preview_table.setHorizontalHeaderLabels(["Change", "Count", "Behavior"])
        self.preview_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.preview_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        layout.addWidget(self.preview_table, 1)
        self.preview_status = QLabel("Preview not built.")
        layout.addWidget(self.preview_status)
        return page

    def _import_page(self) -> QWidget:
        page, layout = self._page("Import", "Imports run in transactional server-side batches. Missing source items are never deleted.")
        self.import_btn = QPushButton("START IMPORT")
        self.import_btn.setObjectName("dangerPrimary")
        self.import_btn.clicked.connect(self._start_import)
        self.progress = QProgressBar()
        self.import_status = QLabel("Waiting.")
        self.import_log = QPlainTextEdit()
        self.import_log.setReadOnly(True)
        layout.addWidget(self.import_btn, 0, Qt.AlignLeft)
        layout.addWidget(self.progress)
        layout.addWidget(self.import_status)
        layout.addWidget(self.import_log, 1)
        return page

    def _apply_style(self) -> None:
        self.setStyleSheet("""
            QMainWindow, QWidget { background: #0b0e14; color: #e8edf5; }
            #sidebar { background: #10151f; border-right: 1px solid #242c3a; }
            #brand { font-size: 20px; font-weight: 800; padding: 18px; }
            #sideNote { color: #9ba8ba; padding: 16px; }
            QListWidget { border: 0; background: transparent; padding: 8px; }
            QListWidget::item { padding: 12px; margin: 2px 0; border-radius: 7px; }
            QListWidget::item:selected { background: #1d4ed8; color: white; }
            #pageTitle { font-size: 28px; font-weight: 800; }
            #pageSubtitle { color: #a8b3c4; }
            #sectionTitle { font-size: 16px; font-weight: 700; padding-top: 12px; }
            #status { color: #9fb6d8; }
            QLineEdit, QComboBox, QPlainTextEdit, QTableWidget {
                background: #0d121b; border: 1px solid #2b3648; border-radius: 6px; padding: 7px;
            }
            QPushButton { background: #1a2230; border: 1px solid #334155; border-radius: 7px; padding: 9px 14px; font-weight: 600; }
            QPushButton#primary { background: #2563eb; border-color: #2563eb; color: white; }
            QPushButton#dangerPrimary { background: #b91c1c; border-color: #ef4444; color: white; font-size: 15px; }
            QProgressBar { border: 1px solid #2b3648; border-radius: 6px; text-align: center; background: #0d121b; }
            QProgressBar::chunk { background: #2563eb; border-radius: 5px; }
        """)

    def _browse(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Choose SQLite database", "", "SQLite DB (*.db *.sqlite *.sqlite3);;All files (*)")
        if path:
            self.file_edit.setText(path)

    def _scan(self) -> None:
        path = self.file_edit.text().strip()
        if not path or not Path(path).exists():
            QMessageBox.warning(self, APP_TITLE, "Choose an existing SQLite database file.")
            return
        try:
            self.source = SQLiteSource(path)
            self.tables = self.source.tables()
            if not self.tables:
                raise RuntimeError("No user tables found in the SQLite database.")
            self.mapping = SQLiteSource.auto_mapping(self.tables)
            self.q_panel.set_tables(self.tables)
            self.o_panel.set_tables(self.tables)
            self.a_panel.set_tables(self.tables, allow_none=True)
            self.q_panel.set_table(self.mapping.question_table, self.tables.get(self.mapping.question_table, []), self.mapping.question)
            self.o_panel.set_table(self.mapping.option_table, self.tables.get(self.mapping.option_table, []), self.mapping.option)
            self.a_panel.set_table(self.mapping.article_table, self.tables.get(self.mapping.article_table, []), self.mapping.article)
            self.scan_status.setText(f"Scanned {len(self.tables)} table(s). Review fields marked * before validation.")
            self.data = None
            self.preview = None
        except Exception as exc:
            QMessageBox.critical(self, APP_TITLE, str(exc))

    def _table_changed(self, panel: MappingPanel, kind: str) -> None:
        table = str(panel.table_combo.currentData() or "")
        columns = self.tables.get(table, [])
        mapping = {field: SQLiteSource.best_column(columns, field) for field in panel.fields}
        panel.set_table(table, columns, mapping)
        self._mapping_changed()

    def _mapping_changed(self) -> None:
        q_table, q_map = self.q_panel.read()
        o_table, o_map = self.o_panel.read()
        a_table, a_map = self.a_panel.read()
        self.mapping = SchemaMapping(q_table, o_table, a_table, q_map, o_map, a_map)
        self.data = None
        self.preview = None

    def _validate(self) -> None:
        if not self.source:
            QMessageBox.warning(self, APP_TITLE, "Scan a source database first.")
            self.nav.setCurrentRow(0)
            return
        self._mapping_changed()
        issues = validate_mapping(self.mapping)
        if not any(issue.severity == "ERROR" for issue in issues):
            try:
                self.data = self.source.load(self.mapping)
                issues.extend(validate_source(self.data))
            except Exception as exc:
                issues.append(Issue("ERROR", "SOURCE_READ_FAILED", str(exc)))
        self.issues = issues
        self.issue_table.setRowCount(len(issues))
        for row, issue in enumerate(issues):
            self.issue_table.setItem(row, 0, QTableWidgetItem(issue.severity))
            self.issue_table.setItem(row, 1, QTableWidgetItem(issue.code))
            self.issue_table.setItem(row, 2, QTableWidgetItem(issue.message))
        errors = sum(issue.severity == "ERROR" for issue in issues)
        warnings = sum(issue.severity == "WARNING" for issue in issues)
        if self.data:
            self.counts_box.setPlainText(f"Questions: {len(self.data.questions):,}\nOptions: {len(self.data.options):,}\nLibrary articles: {len(self.data.articles):,}\nErrors: {errors}    Warnings: {warnings}")
        else:
            self.counts_box.setPlainText(f"Errors: {errors}    Warnings: {warnings}")
        self.validation_summary.setText(f"BLOCKED — {errors} error(s)" if errors else f"PASSED — 0 errors, {warnings} warning(s)")
        if not errors:
            self.nav.setCurrentRow(2)

    def _environment_changed(self, environment: str) -> None:
        if environment == "DEV":
            self.url_edit.setText(os.getenv("ROYAL_DEV_SUPABASE_URL", ""))
            self.key_edit.setText(os.getenv("ROYAL_DEV_SERVICE_ROLE_KEY", ""))
        else:
            self.url_edit.setText(os.getenv("ROYAL_PROD_SUPABASE_URL", ""))
            self.key_edit.setText(os.getenv("ROYAL_PROD_SERVICE_ROLE_KEY", ""))
        self.api = None
        self.conn_status.setText("Not connected")
        self.preview = None

    def _connect(self) -> None:
        url = self.url_edit.text().strip()
        key = self.key_edit.text().strip()
        if not url.startswith("https://") or not key:
            QMessageBox.warning(self, APP_TITLE, "Enter the Supabase URL and service-role key.")
            return
        try:
            api = RoyalApi(url, key)
            api.health()
            self.api = api
            self.conn_status.setText("Connected")
            self.pathways_cache = api.pathways()
            self._fill_pathways()
        except Exception as exc:
            self.api = None
            self.conn_status.setText("Connection failed")
            QMessageBox.critical(self, APP_TITLE, str(exc))

    def _fill_pathways(self) -> None:
        self.pathway_combo.blockSignals(True)
        self.pathway_combo.clear()
        for pathway in self.pathways_cache:
            self.pathway_combo.addItem(pathway["name"], int(pathway["id"]))
        self.pathway_combo.blockSignals(False)
        self._pathway_selected()

    def _pathway_selected(self) -> None:
        self.bank_combo.clear()
        if not self.api or self.pathway_combo.currentData() is None:
            return
        for bank in self.api.banks(int(self.pathway_combo.currentData())):
            self.bank_combo.addItem(bank["name"], int(bank["id"]))
        self.preview = None

    def _mode(self) -> str:
        if self.mode_new_pathway.isChecked():
            return "new_pathway_bank"
        if self.mode_new_bank.isChecked():
            return "new_bank"
        return "update"

    def _mode_changed(self) -> None:
        mode = self._mode()
        self.pathway_combo.setEnabled(mode in {"new_bank", "update"})
        self.bank_combo.setEnabled(mode == "update")
        self.new_pathway_name.setEnabled(mode == "new_pathway_bank")
        self.new_pathway_desc.setEnabled(mode == "new_pathway_bank")
        self.new_bank_name.setEnabled(mode in {"new_pathway_bank", "new_bank"})
        self.new_bank_desc.setEnabled(mode in {"new_pathway_bank", "new_bank"})
        self.preview = None

    def _ids(self) -> tuple[int | None, int | None]:
        mode = self._mode()
        pathway_id = int(self.pathway_combo.currentData()) if mode in {"new_bank", "update"} and self.pathway_combo.currentData() is not None else None
        bank_id = int(self.bank_combo.currentData()) if mode == "update" and self.bank_combo.currentData() is not None else None
        return pathway_id, bank_id

    def _preflight(self, require_preview: bool = False) -> bool:
        if not self.data or any(issue.severity == "ERROR" for issue in self.issues):
            QMessageBox.warning(self, APP_TITLE, "Run Verification and fix all errors first.")
            self.nav.setCurrentRow(1)
            return False
        if not self.api:
            QMessageBox.warning(self, APP_TITLE, "Connect to the target environment first.")
            self.nav.setCurrentRow(2)
            return False
        mode = self._mode()
        pathway_id, bank_id = self._ids()
        if mode == "new_pathway_bank" and (not self.new_pathway_name.text().strip() or not self.new_bank_name.text().strip()):
            QMessageBox.warning(self, APP_TITLE, "Enter both the new Pathway name and new Bank name.")
            return False
        if mode == "new_bank" and (pathway_id is None or not self.new_bank_name.text().strip()):
            QMessageBox.warning(self, APP_TITLE, "Choose a Pathway and enter the new Bank name.")
            return False
        if mode == "update" and bank_id is None:
            QMessageBox.warning(self, APP_TITLE, "Choose the existing Bank to update.")
            return False
        if self.env_combo.currentText() == "PRODUCTION" and self.prod_confirm.text() != "PRODUCTION":
            QMessageBox.warning(self, APP_TITLE, 'Production is locked. Type exactly "PRODUCTION".')
            return False
        if require_preview and self.preview is None:
            QMessageBox.warning(self, APP_TITLE, "Build the Preview before importing.")
            self.nav.setCurrentRow(3)
            return False
        return True

    def _build_preview(self) -> None:
        if not self._preflight():
            return
        try:
            _, bank_id = self._ids()
            self.preview_status.setText("Comparing source with target...")
            QApplication.processEvents()
            self.preview = build_preview(self.api, self.data, bank_id)
            rows = self.preview.rows()
            self.preview_table.setRowCount(len(rows))
            for row_index, (label, count, behavior) in enumerate(rows):
                self.preview_table.setItem(row_index, 0, QTableWidgetItem(label))
                self.preview_table.setItem(row_index, 1, QTableWidgetItem(f"{count:,}"))
                self.preview_table.setItem(row_index, 2, QTableWidgetItem(behavior))
            self.preview_status.setText("Preview ready. Target-only content will not be deleted.")
        except Exception as exc:
            self.preview = None
            QMessageBox.critical(self, APP_TITLE, str(exc))

    def _start_import(self) -> None:
        if not self._preflight(require_preview=True):
            return
        environment = self.env_combo.currentText()
        warning = (
            f"Start import to {environment}?\n\n"
            f"Questions: {len(self.data.questions):,}\n"
            f"Options: {len(self.data.options):,}\n"
            f"Articles: {len(self.data.articles):,}\n\n"
            "Target content absent from the source will remain untouched."
        )
        if environment == "PRODUCTION":
            warning = "PRODUCTION IMPORT\n\n" + warning
        if QMessageBox.question(self, APP_TITLE, warning, QMessageBox.Yes | QMessageBox.No) != QMessageBox.Yes:
            return

        pathway_id, bank_id = self._ids()
        self.import_btn.setEnabled(False)
        self.progress.setValue(0)
        self.import_log.clear()
        self.worker = ImportWorker(
            self.api,
            self.data,
            self._mode(),
            pathway_id,
            bank_id,
            self.new_pathway_name.text().strip(),
            self.new_pathway_desc.text().strip(),
            self.new_bank_name.text().strip(),
            self.new_bank_desc.text().strip(),
        )
        self.worker.progress.connect(self._import_progress)
        self.worker.completed.connect(self._import_completed)
        self.worker.failed.connect(self._import_failed)
        self.worker.start()

    def _import_progress(self, percent: int, message: str) -> None:
        self.progress.setValue(percent)
        self.import_status.setText(message)
        self.import_log.appendPlainText(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def _import_completed(self, log: dict) -> None:
        self.import_btn.setEnabled(True)
        self.progress.setValue(100)
        self.import_status.setText("Import completed successfully.")
        self.import_log.appendPlainText(f"Batch: {log['batch_id']}")
        self.import_log.appendPlainText(f"Bank ID: {log['bank_id']}")
        self.import_log.appendPlainText(f"Log: {log['log_path']}")
        QMessageBox.information(self, APP_TITLE, f"Import completed.\n\nBank ID: {log['bank_id']}\nLog: {log['log_path']}")
        self.preview = None
        if self.api:
            self.pathways_cache = self.api.pathways()
            self._fill_pathways()

    def _import_failed(self, details: str) -> None:
        self.import_btn.setEnabled(True)
        self.import_status.setText("Import failed. The failing server-side batch was rolled back.")
        self.import_log.appendPlainText(details)
        QMessageBox.critical(self, APP_TITLE, "Import failed. See the Import log for details.")


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName(APP_TITLE)
    font = QFont()
    font.setPointSize(10)
    app.setFont(font)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
