#!/usr/bin/env python3
"""dmenu-like picker for ani-cli --gui mode.

Reads options from stdin (one per line), shows a searchable Tkinter popup,
prints the selected line(s) to stdout. Supports --input for text entry
and --multi for multi-selection.
"""

import argparse
import sys
import tkinter as tk


def run_input_mode(prompt):
    root = tk.Tk()
    root.title(prompt or "Input")
    root.geometry("500x60")
    root.resizable(False, False)

    entry = tk.Entry(root, font=("Segoe UI", 14))
    entry.pack(fill="x", expand=True, padx=10, pady=15)
    entry.focus_force()

    def submit(_=None):
        print(entry.get())
        root.destroy()

    def cancel(_=None):
        root.destroy()

    entry.bind("<Return>", submit)
    entry.bind("<Escape>", cancel)
    root.protocol("WM_DELETE_WINDOW", cancel)
    root.mainloop()


def run_select_mode(prompt, multi):
    options = sys.stdin.read()
    options = [line for line in options.splitlines() if line]
    if not options:
        return

    root = tk.Tk()
    root.title(prompt or "Select")
    root.geometry("600x500")

    search_var = tk.StringVar()
    search = tk.Entry(root, textvariable=search_var, font=("Segoe UI", 13))
    search.pack(fill="x", padx=10, pady=(10, 5))
    search.focus_force()

    listframe = tk.Frame(root)
    listframe.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    scrollbar = tk.Scrollbar(listframe)
    scrollbar.pack(side="right", fill="y")

    mode = "extended" if multi else "single"
    listbox = tk.Listbox(
        listframe,
        font=("Segoe UI", 12),
        yscrollcommand=scrollbar.set,
        selectmode=mode,
        activestyle="none",
    )
    listbox.pack(side="left", fill="both", expand=True)
    scrollbar.config(command=listbox.yview)

    def populate(filter_text=""):
        listbox.delete(0, tk.END)
        ft = filter_text.lower()
        for opt in options:
            if ft in opt.lower():
                listbox.insert(tk.END, opt)
        if listbox.size() > 0:
            listbox.selection_set(0)

    def on_search(_=None):
        populate(search_var.get())

    search_var.trace("w", on_search)
    populate()

    def submit(_=None):
        sel = listbox.curselection()
        if sel:
            for i in sel:
                print(listbox.get(i))
            root.destroy()

    def cancel(_=None):
        root.destroy()

    listbox.bind("<Double-Button-1>", submit)
    search.bind("<Return>", submit)
    root.bind("<Escape>", cancel)
    root.protocol("WM_DELETE_WINDOW", cancel)
    root.mainloop()


def main():
    parser = argparse.ArgumentParser(description="ani-cli GUI picker")
    parser.add_argument("--prompt", default="", help="Window/prompt title")
    parser.add_argument("--multi", action="store_true", help="Allow multi-selection")
    parser.add_argument("--input", action="store_true", help="Text input mode")
    args = parser.parse_args()

    if args.input:
        run_input_mode(args.prompt)
    else:
        run_select_mode(args.prompt, args.multi)


if __name__ == "__main__":
    main()
