/**
 * BookLibraryEditor — inline editor for creating / editing a book library.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { ShellApi } from "@tokimo/sdk";
import {
  type AvatarData,
  AvatarPicker,
  Button,
  Form,
  type FormInstance,
  Input,
  Modal,
  parseAvatar,
  ScrollArea,
  Select,
  StorageBindingsField,
  useToast,
  type VideoBinding,
} from "@tokimo/ui";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bookApi, vfsApi } from "../api";
import { useVfsBrowse } from "../hooks/useVfsBrowse";
import { type BookTranslator, useBookI18n } from "../i18n";
import type { BookContainerOutput } from "../types";

const BOOK_TYPES = [
  { value: "book", labelKey: "libraryTypeBook" },
  { value: "manga", labelKey: "libraryTypeManga" },
  { value: "ebook", labelKey: "libraryTypeEbook" },
] as const;

interface BookLibraryEditorProps {
  bookId?: string;
  shell: ShellApi;
  onSaved?: (savedId: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}

export default function BookLibraryEditor({
  bookId,
  shell,
  onSaved,
  onDeleted,
  onCancel,
}: BookLibraryEditorProps) {
  const toast = useToast();
  const { t } = useBookI18n();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const onBrowse = useVfsBrowse(shell);

  const { data: libraries = [] } = bookApi.list.useQuery();
  const { data: vfsSources = [] } = vfsApi.list.useQuery();
  const book = bookId ? libraries.find((c) => c.id === bookId) : undefined;

  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  const prevId = useRef(bookId);
  useEffect(() => {
    if (prevId.current !== bookId) {
      prevId.current = bookId;
      setDeleteOpen(false);
      setDeleteInput("");
    }
  }, [bookId]);

  useEffect(() => {
    if (book) {
      form.setFieldsValue({
        type: book.type,
        name: book.name,
        description: book.description ?? "",
      });
      setAvatar(parseAvatar(book.avatar));
    } else {
      form.resetFields();
      form.setFieldsValue({ type: "book" });
      setAvatar({ type: "icon", icon: "lucide:book-open", color: "#8b5cf6" });
    }
  }, [book, form]);

  const createMutation = bookApi.create.useMutation({
    onSuccess: () => {
      toast.success(t("libraryCreated"));
      bookApi.list.invalidate(qc);
    },
    onError: (e) => toast.error(e.message || t("libraryCreateFailed")),
  });

  const updateMutation = bookApi.update.useMutation({
    onSuccess: () => {
      toast.success(t("librarySaved"));
      bookApi.list.invalidate(qc);
    },
    onError: (e) => toast.error(e.message || t("librarySaveFailed")),
  });

  const deleteMutation = bookApi.delete.useMutation({
    onSuccess: () => {
      toast.success(t("libraryDeleted"));
      bookApi.list.invalidate(qc);
      setDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => toast.error(e.message || t("libraryDeleteFailed")),
  });

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    const rawBindings =
      (form.getFieldValue("bindings") as VideoBinding[] | undefined) ?? [];
    const firstBinding = rawBindings.find((b) => b.sourceId && b.rootPath);

    let savedId: string;
    if (book) {
      await updateMutation.mutateAsync({
        id: book.id,
        name: values.name as string,
        kind: book.type,
        sourceId: firstBinding?.sourceId,
        rootPath: firstBinding?.rootPath,
      });
      savedId = book.id;
    } else {
      const created = await createMutation.mutateAsync({
        name: values.name as string,
        kind: (values.type as string) || "book",
        sourceId: firstBinding?.sourceId,
        rootPath: firstBinding?.rootPath,
      });
      savedId = created.id;
    }
    onSaved?.(savedId);
  }, [form, book, createMutation, updateMutation, onSaved]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Form
        form={form as FormInstance}
        layout="vertical"
        autoComplete="off"
        className="flex min-h-0 flex-1 flex-col"
      >
        <ScrollArea
          direction="vertical"
          className="min-h-0 flex-1"
          innerClassName="space-y-5 px-5 py-5"
        >
          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              {t("editorBasicInfo")}
            </h4>

            <div className="mb-5">
              <AvatarPicker value={avatar} onChange={setAvatar} size={80} />
            </div>

            {!book && (
              <Form.Item
                name="type"
                label={t("editorLibraryType")}
                rules={[{ required: true, message: t("editorSelectType") }]}
              >
                <Select
                  options={BOOK_TYPES.map((type) => ({
                    label: t(type.labelKey),
                    value: type.value,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              name="name"
              label={t("commonName")}
              rules={[{ required: true, message: t("editorNameRequired") }]}
            >
              <Input placeholder={t("editorNamePlaceholder")} size="large" />
            </Form.Item>

            <Form.Item name="description" label={t("editorDescription")} className="!mb-0">
              <Input.TextArea placeholder={t("editorDescriptionPlaceholder")} rows={3} />
            </Form.Item>
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              {t("editorPathConfig")}
            </h4>
            <StorageBindingsField
              sources={vfsSources}
              form={form}
              initialSources={book?.sources}
              onBrowse={onBrowse}
            />
          </div>
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-between border-t border-border-base px-5 py-3">
          <div>
            {book && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} className="mr-1" />
                {t("commonDelete")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={onCancel}>
              {t("commonCancel")}
            </Button>
            <Button loading={isPending} onClick={() => void handleSave()}>
              {book ? t("commonSave") : t("commonCreate")}
            </Button>
          </div>
        </div>
      </Form>

      {book && (
        <DeleteConfirmModal
          book={book}
          open={deleteOpen}
          deleteInput={deleteInput}
          setDeleteInput={setDeleteInput}
          onCancel={() => {
            setDeleteOpen(false);
            setDeleteInput("");
          }}
          onConfirm={() => deleteMutation.mutate(book.id)}
          loading={deleteMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({
  book,
  open,
  deleteInput,
  setDeleteInput,
  onCancel,
  onConfirm,
  loading,
  t,
}: {
  book: BookContainerOutput;
  open: boolean;
  deleteInput: string;
  setDeleteInput: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  t: BookTranslator;
}) {
  return (
    <Modal title={t("deleteLibraryTitle")} open={open} onCancel={onCancel} footer={null}>
      <div className="space-y-4 pt-1">
        <p className="text-sm text-fg-secondary">
          {t("deleteLibraryMessage", { name: book.name, irreversible: t("irreversible") })}
        </p>
        <Input
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          placeholder={book.name}
          onPressEnter={() => {
            if (deleteInput === book.name) onConfirm();
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={onCancel}>
            {t("commonCancel")}
          </Button>
          <Button
            variant="danger"
            disabled={deleteInput !== book.name}
            loading={loading}
            onClick={onConfirm}
          >
            {t("confirmDelete")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
