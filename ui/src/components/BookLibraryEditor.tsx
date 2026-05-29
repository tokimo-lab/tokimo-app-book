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
import type { BookContainerOutput } from "../types";

const BOOK_TYPES = [
  { value: "book", label: "小说" },
  { value: "manga", label: "漫画" },
  { value: "ebook", label: "电子书" },
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
      toast.success("小说库已创建");
      bookApi.list.invalidate(qc);
    },
    onError: (e) => toast.error(e.message || "创建失败"),
  });

  const updateMutation = bookApi.update.useMutation({
    onSuccess: () => {
      toast.success("已保存");
      bookApi.list.invalidate(qc);
    },
    onError: (e) => toast.error(e.message || "保存失败"),
  });

  const deleteMutation = bookApi.delete.useMutation({
    onSuccess: () => {
      toast.success("小说库已删除");
      bookApi.list.invalidate(qc);
      setDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => toast.error(e.message || "删除失败"),
  });

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    const rawBindings =
      (form.getFieldValue("bindings") as VideoBinding[] | undefined) ?? [];
    const sources = rawBindings
      .filter((b) => b.sourceId && b.rootPath)
      .map((b, i) => ({
        sourceId: b.sourceId,
        rootPath: b.rootPath,
        sortOrder: i,
        isDefaultDownload: b.isDefaultDownload ?? i === 0,
      }));

    let savedId: string;
    if (book) {
      await updateMutation.mutateAsync({
        id: book.id,
        name: values.name as string,
        avatar: avatar as Record<string, unknown> | null,
        description: (values.description as string) || null,
        sources,
      });
      savedId = book.id;
    } else {
      const created = await createMutation.mutateAsync({
        name: values.name as string,
        type: (values.type as string) || "book",
        avatar: avatar as Record<string, unknown> | null,
        description: (values.description as string) || null,
        sources,
      });
      savedId = created.id;
    }
    onSaved?.(savedId);
  }, [form, book, avatar, createMutation, updateMutation, onSaved]);

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
              基本信息
            </h4>

            <div className="mb-5">
              <AvatarPicker value={avatar} onChange={setAvatar} size={80} />
            </div>

            {!book && (
              <Form.Item
                name="type"
                label="库类型"
                rules={[{ required: true, message: "请选择类型" }]}
              >
                <Select
                  options={BOOK_TYPES.map((t) => ({
                    label: t.label,
                    value: t.value,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: "请输入小说库名称" }]}
            >
              <Input placeholder="如：我的小说" size="large" />
            </Form.Item>

            <Form.Item name="description" label="描述" className="!mb-0">
              <Input.TextArea placeholder="可选描述" rows={3} />
            </Form.Item>
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              路径配置
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
                删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={onCancel}>
              取消
            </Button>
            <Button loading={isPending} onClick={() => void handleSave()}>
              {book ? "保存" : "创建"}
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
}: {
  book: BookContainerOutput;
  open: boolean;
  deleteInput: string;
  setDeleteInput: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Modal title="⚠️ 删除小说库" open={open} onCancel={onCancel} footer={null}>
      <div className="space-y-4 pt-1">
        <p className="text-sm text-fg-secondary">
          此操作将永久删除{" "}
          <span className="font-semibold text-fg-primary">{book.name}</span>{" "}
          及其所有数据，
          <span className="font-semibold text-red-500">不可恢复</span>。
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
            取消
          </Button>
          <Button
            variant="danger"
            disabled={deleteInput !== book.name}
            loading={loading}
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </div>
      </div>
    </Modal>
  );
}
