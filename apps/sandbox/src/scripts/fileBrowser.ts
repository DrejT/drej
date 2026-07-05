import { api } from "./api";

export function mountFileBrowser(sandboxId: string): { dispose(): void } {
  const pathInput = document.getElementById("file-path-input") as HTMLInputElement;
  const listBtn = document.getElementById("file-list-btn") as HTMLButtonElement;
  const tree = document.getElementById("file-tree") as HTMLUListElement;
  const editor = document.getElementById("file-editor") as HTMLTextAreaElement;
  const saveBtn = document.getElementById("file-save-btn") as HTMLButtonElement;

  let currentFile: string | null = null;

  async function refresh() {
    tree.innerHTML = "";
    editor.value = "";
    currentFile = null;
    try {
      const { entries } = await api.listDirectory(sandboxId, pathInput.value || "/");
      for (const entry of entries) {
        const li = document.createElement("li");
        li.textContent = entry.type === "directory" ? `${entry.path}/` : entry.path;
        li.className = "cursor-pointer hover:text-[var(--color-accent)]";
        li.addEventListener("click", () => {
          if (entry.type === "directory") {
            pathInput.value = entry.path;
            void refresh();
          } else {
            void openFile(entry.path);
          }
        });
        tree.appendChild(li);
      }
    } catch (err) {
      tree.innerHTML = `<li class="text-[var(--color-danger)]">${String(err)}</li>`;
    }
  }

  async function openFile(path: string) {
    try {
      const { content } = await api.readFile(sandboxId, path);
      editor.value = content;
      currentFile = path;
    } catch (err) {
      editor.value = `# failed to read ${path}: ${String(err)}`;
    }
  }

  async function save() {
    if (!currentFile) return;
    saveBtn.disabled = true;
    try {
      await api.writeFile(sandboxId, currentFile, editor.value);
    } finally {
      saveBtn.disabled = false;
    }
  }

  listBtn.addEventListener("click", () => void refresh());
  saveBtn.addEventListener("click", () => void save());
  void refresh();

  return {
    dispose() {
      listBtn.replaceWith(listBtn.cloneNode(true));
      saveBtn.replaceWith(saveBtn.cloneNode(true));
    },
  };
}
