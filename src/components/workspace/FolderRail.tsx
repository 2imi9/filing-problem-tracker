"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Button, ConfirmDialog, Icon, IconButton, Spinner, TextInput, useFocusAfterUpdate } from "@/components/ui";
import { FOLDER_NAME_MAX } from "@/lib/schemas";
import type { RailFolder } from "./model";
import styles from "./workspace.module.css";

interface FolderRailProps {
  folders: readonly RailFolder[];
  /** False until the folders have been asked for. */
  ready: boolean;
  /** Set when the folders could not be loaded. */
  loadError: string | null;
  /** How many panels are open now. Nothing can be saved from an empty workspace. */
  openCount: number;
  onOpen: (folder: RailFolder) => void;
  /** Each resolves to null on success, or a sentence saying what went wrong. */
  onSave: (name: string) => Promise<string | null>;
  onRename: (folder: RailFolder, name: string) => Promise<string | null>;
  onDelete: (folder: RailFolder) => Promise<string | null>;
}

const panelCount = (count: number) => `${count} ${count === 1 ? "panel" : "panels"}`;

/** Saved sets of panels: open one, save the current panels as one, rename, delete. */
export function FolderRail({ folders, ready, loadError, openCount, onOpen, onSave, onRename, onDelete }: FolderRailProps) {
  const headingId = useId();
  const nameId = useId();
  const renameId = useId();
  // Every form and button here replaces or removes itself when used, so each step names where focus lands.
  const heading = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusAfterUpdate = useFocusAfterUpdate();
  const openButtonOf = (id: string) => list.current?.querySelector<HTMLElement>(`[data-folder-id="${CSS.escape(id)}"] button`);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<RailFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const examplesOnly = folders.length > 0 && folders.every((folder) => folder.example);

  const submitSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const failed = await onSave(name);
    setBusy(false);
    setProblem(failed);
    if (failed === null) {
      setSaid(`Saved the folder ${name.trim()} with ${panelCount(openCount)}.`);
      setSaving(false);
      setName("");
      focusAfterUpdate(() => saveButton.current);
    }
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>, folder: RailFolder) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const failed = await onRename(folder, renameValue);
    setBusy(false);
    setProblem(failed);
    if (failed === null) {
      setSaid(`Renamed the folder to ${renameValue.trim()}.`);
      setRenamingId(null);
      focusAfterUpdate(() => openButtonOf(folder.id));
    }
  };

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    const failed = await onDelete(deleting);
    setBusy(false);
    setProblem(failed);
    if (failed === null) {
      setSaid(`Deleted the folder ${deleting.name}.`);
      // The folder's own buttons are gone, so the dialog has nothing to give focus back to.
      focusAfterUpdate(() => heading.current);
    }
    setDeleting(null);
  };

  return (
    <section className={styles.rail} aria-labelledby={headingId}>
      <h2 ref={heading} id={headingId} className={styles.railTitle} tabIndex={-1}>
        Folders
      </h2>
      <p className={styles.railHint}>A folder is a saved set of panels. Opening one replaces the panels on the grid.</p>

      {saving ? (
        <form className={styles.railForm} onSubmit={(event) => void submitSave(event)} noValidate>
          <TextInput
            id={nameId}
            label="Folder name"
            value={name}
            onChange={(value) => {
              setName(value);
              setProblem(null);
            }}
            maxLength={FOLDER_NAME_MAX}
            hint="Saving under the name of a folder you already have replaces that folder."
            error={problem}
            required
          />
          <div className={styles.railFormButtons}>
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save folder
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSaving(false);
                setProblem(null);
                focusAfterUpdate(() => saveButton.current);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={saveButton}
          icon="save"
          block
          disabled={openCount === 0}
          onClick={() => {
            setSaving(true);
            setRenamingId(null);
            setProblem(null);
            focusAfterUpdate(() => document.getElementById(nameId));
          }}
        >
          Save current as folder
        </Button>
      )}
      {openCount === 0 && !saving ? <p className={styles.railHint}>Open a panel first, then save the set as a folder.</p> : null}

      {!ready ? <Spinner label="Loading folders" /> : null}
      {loadError ? <Alert tone="warning">Your saved folders could not be loaded. {loadError}</Alert> : null}
      {problem && !saving && renamingId === null ? (
        <Alert tone="error" live>
          {problem}
        </Alert>
      ) : null}

      {ready && folders.length > 0 ? (
        <>
          {examplesOnly ? <p className={styles.railHint}>Examples built on the sample data, listed while your own folders cannot be loaded.</p> : null}
          <ul ref={list} className={styles.folderList}>
            {folders.map((folder) => (
              <li key={folder.id} className={styles.folderItem} data-folder-id={folder.id}>
                {renamingId === folder.id ? (
                  <form className={styles.railForm} onSubmit={(event) => void submitRename(event, folder)} noValidate>
                    <TextInput
                      id={renameId}
                      label={`New name for ${folder.name}`}
                      value={renameValue}
                      onChange={(value) => {
                        setRenameValue(value);
                        setProblem(null);
                      }}
                      maxLength={FOLDER_NAME_MAX}
                      error={problem}
                      required
                    />
                    <div className={styles.railFormButtons}>
                      <Button type="submit" variant="primary" size="sm" loading={busy}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setRenamingId(null);
                          setProblem(null);
                          focusAfterUpdate(() => openButtonOf(folder.id));
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    {/* The name a screen reader hears starts with the words on the button, so speech control works too. */}
                    <button type="button" className={styles.folderOpen} onClick={() => onOpen(folder)}>
                      <Icon name="folder" />
                      <span className={styles.folderText}>
                        <span className={styles.folderName}>
                          <span className="visually-hidden">Open folder </span>
                          {folder.name}
                        </span>
                        <span className={styles.folderMeta}>
                          {panelCount(folder.panels.length)}
                          {folder.example ? ", example" : ""}
                        </span>
                      </span>
                    </button>
                    {folder.example ? null : (
                      <span className={styles.folderActions}>
                        <IconButton
                          icon="edit"
                          size="sm"
                          label={`Rename folder ${folder.name}`}
                          onClick={() => {
                            setRenamingId(folder.id);
                            setRenameValue(folder.name);
                            setSaving(false);
                            setProblem(null);
                            focusAfterUpdate(() => document.getElementById(renameId));
                          }}
                        />
                        <IconButton icon="trash" size="sm" label={`Delete folder ${folder.name}`} onClick={() => setDeleting(folder)} />
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {ready && folders.length === 0 && !loadError ? <p className={styles.railHint}>No folders yet.</p> : null}

      <p className="visually-hidden" role="status">
        {said}
      </p>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this folder?"
        confirmLabel="Delete folder"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        {deleting ? `The folder ${deleting.name} will be removed. The panels open on the grid stay as they are.` : null}
      </ConfirmDialog>
    </section>
  );
}
