import { useQueryClient } from "@tanstack/react-query";
import {
  AppSidebar,
  Button,
  Form,
  type FormInstance,
  Input,
  Modal,
  ScrollNav,
  type ScrollNavItem,
  Select,
  Spin,
  Switch,
} from "@tokiomo/components";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppAvatarPicker from "@/apps/settings/components/app-dialog/AppAvatarPicker";
import type { VfsDto } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import type { NovelContainerOutput } from "@/generated/rust-types/NovelContainerOutput";
import { AppIcon } from "@/shared/components/icons";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useMessage, useWindowNav } from "@/system";
import VideoBindingsField, {
  type VideoBinding,
} from "./video-library/VideoBindingsField";

// ── Types ──────────────────────────────────────────────────────────────────────

const NOVEL_TYPES = [
  { value: "novel", label: "小说" },
  { value: "manga", label: "漫画" },
  { value: "ebook", label: "电子书" },
] as const;

const NAV_ITEMS: ScrollNavItem[] = [
  { key: "info", label: "基本信息" },
  { key: "bindings", label: "路径配置" },
];

// ── Library form ──────────────────────────────────────────────────────────────

function NovelLibraryForm({
  novel,
  vfsSources,
  onSaved,
  onDeleted,
  onCancel,
}: {
  novel?: NovelContainerOutput;
  vfsSources: VfsDto[];
  onSaved: () => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}) {
  const message = useMessage();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  useEffect(() => {
    if (novel) {
      form.setFieldsValue({
        type: novel.type,
        name: novel.name,
        icon: novel.icon ?? "",
        color: novel.color ?? "",
        description: novel.description ?? "",
        scrapeEnabled: novel.scrapeEnabled,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        type: "novel",
        icon: "lucide:book-open",
        color: "#8b5cf6",
        scrapeEnabled: false,
      });
    }
  }, [novel, form]);

  const createMutation = api.novel.create.useMutation({
    onSuccess: () => {
      message.success("小说库已创建");
      api.novel.list.invalidate(qc);
      onSaved();
    },
    onError: (e) => message.error(e.message || "创建失败"),
  });

  const updateMutation = api.novel.update.useMutation({
    onSuccess: () => {
      message.success("已保存");
      api.novel.list.invalidate(qc);
      onSaved();
    },
    onError: (e) => message.error(e.message || "保存失败"),
  });

  const deleteMutation = api.novel.delete.useMutation({
    onSuccess: () => {
      message.success("小说库已删除");
      api.novel.list.invalidate(qc);
      setDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => message.error(e.message || "删除失败"),
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

    if (novel) {
      await updateMutation.mutateAsync({
        id: novel.id,
        name: values.name as string,
        icon: (values.icon as string) || null,
        color: (values.color as string) || null,
        description: (values.description as string) || null,
        scrapeEnabled: values.scrapeEnabled as boolean,
        sources,
      });
    } else {
      await createMutation.mutateAsync({
        name: values.name as string,
        type: (values.type as string) || "novel",
        icon: (values.icon as string) || null,
        color: (values.color as string) || null,
        description: (values.description as string) || null,
        scrapeEnabled: (values.scrapeEnabled as boolean) ?? false,
        sources,
      });
    }
  }, [form, novel, createMutation, updateMutation]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const iconValue: string = Form.useWatch("icon", form) ?? "";
  const colorValue: string = Form.useWatch("color", form) ?? "#8b5cf6";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Form
        form={form as FormInstance}
        layout="vertical"
        autoComplete="off"
        className="flex min-h-0 flex-1 flex-col"
      >
        <ScrollNav items={NAV_ITEMS} className="min-h-0 flex-1 px-6 py-5">
          {/* 基本信息 */}
          <ScrollNav.Section id="info" title="基本信息">
            <Form.Item name="icon" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="color" hidden>
              <Input />
            </Form.Item>

            {/* Clickable avatar */}
            <div className="group relative mb-5 w-fit">
              <AppIcon
                icon={iconValue}
                color={colorValue}
                size={80}
                onClick={() => setPickerOpen(true)}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <Pencil className="h-5 w-5 text-white" />
              </div>
            </div>

            {!novel && (
              <Form.Item
                name="type"
                label="库类型"
                rules={[{ required: true, message: "请选择类型" }]}
              >
                <Select
                  options={NOVEL_TYPES.map((t) => ({
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
          </ScrollNav.Section>

          {/* 路径配置 */}
          <ScrollNav.Section id="bindings" title="路径配置" className="mt-10">
            <VideoBindingsField
              sources={vfsSources}
              form={form}
              initialSources={novel?.sources}
            />
            <div className="mt-4 border-t border-[var(--glass-border)] pt-4">
              <Form.Item
                name="scrapeEnabled"
                label="自动刮削"
                valuePropName="checked"
                extra="扫描后自动抓取封面、作者等元数据"
              >
                <Switch />
              </Form.Item>
            </div>
          </ScrollNav.Section>
        </ScrollNav>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border-base)] px-6 py-4">
          <div>
            {novel && (
              <Button
                variant="danger"
                size="small"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={13} className="mr-1" />
                删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onCancel && (
              <Button variant="default" onClick={onCancel}>
                取消
              </Button>
            )}
            <Button loading={isPending} onClick={() => void handleSave()}>
              {novel ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </Form>

      {/* Delete confirm */}
      <Modal
        title="⚠️ 删除小说库"
        open={deleteOpen}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteInput("");
        }}
        footer={null}
      >
        <div className="space-y-4 pt-1">
          <p className="text-sm text-fg-secondary">
            此操作将永久删除{" "}
            <span className="font-semibold text-fg-primary">{novel?.name}</span>{" "}
            及其所有数据，
            <span className="font-semibold text-red-500">不可恢复</span>。
          </p>
          <Input
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder={novel?.name}
            onPressEnter={() => {
              if (deleteInput === novel?.name) deleteMutation.mutate(novel.id);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="default"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteInput("");
              }}
            >
              取消
            </Button>
            <Button
              variant="danger"
              disabled={deleteInput !== novel?.name}
              loading={deleteMutation.isPending}
              onClick={() => {
                if (novel) deleteMutation.mutate(novel.id);
              }}
            >
              确认删除
            </Button>
          </div>
        </div>
      </Modal>

      {/* Avatar picker */}
      <AppAvatarPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={{ icon: iconValue, color: colorValue }}
        onChange={(val) => {
          form.setFieldsValue({ icon: val.icon, color: val.color });
        }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NovelSettingsPage() {
  const { params, replace } = useWindowNav();
  const { data: libraries = [], isLoading } = api.novel.list.useQuery();
  const { data: vfsSources = [] } = api.vfs.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const sidebarCollapsed = containerWidth > 0 && containerWidth < 720;
  const selectedId: string | "new" | null = (params.novelId as string) ?? null;

  const setSelectedId = useCallback(
    (id: string | "new" | null) => {
      replace(id ? `/novel-settings/${id}` : "/novel-settings");
    },
    [replace],
  );

  const selectedNovel = libraries.find((c) => c.id === selectedId);

  const handleSaved = useCallback(() => {
    if (selectedId === "new") setSelectedId(null);
  }, [selectedId, setSelectedId]);

  const handleDeleted = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  const sidebarSections = [
    {
      items: libraries.map((lib) => ({
        key: lib.id,
        icon: <AppIcon icon={lib.icon} color={lib.color} size={16} />,
        label: lib.name,
        extra: (
          <span className="text-[10px] tabular-nums text-fg-muted">
            {lib.itemCount}
          </span>
        ),
      })),
    },
  ];

  return (
    <div
      ref={containerRef}
      className="grid h-full overflow-hidden"
      style={{ gridTemplateColumns: `${sidebarCollapsed ? 48 : 188}px 1fr` }}
    >
      {/* Sidebar */}
      <AppSidebar
        className="rounded-bl-lg"
        width={sidebarCollapsed ? 48 : 188}
        header={
          <div className="flex w-full items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-fg-muted" />
            <span className="flex-1 text-sm font-medium text-fg-primary">
              TokimoNovel
            </span>
          </div>
        }
        sections={sidebarSections}
        activeKey={selectedId === "new" ? undefined : (selectedId ?? undefined)}
        onSelect={setSelectedId}
        loading={isLoading}
        footer={
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
            onClick={() => setSelectedId("new")}
          >
            <Plus size={14} />
            新建小说库
          </button>
        }
      />

      {/* Form panel */}
      <div className="flex min-h-0 flex-col overflow-hidden">
        {selectedId === "new" ? (
          <NovelLibraryForm
            key="new"
            vfsSources={vfsSources}
            onSaved={handleSaved}
            onCancel={() => setSelectedId(null)}
          />
        ) : selectedNovel ? (
          <NovelLibraryForm
            key={selectedNovel.id}
            novel={selectedNovel}
            vfsSources={vfsSources}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            {isLoading ? (
              <Spin />
            ) : (
              <div className="flex flex-col items-center gap-3 text-fg-muted">
                <AppIcon iconComponent={BookOpen} color="#8b5cf6" size={56} />
                <p className="text-sm">
                  {libraries.length === 0
                    ? "点击左下角「新建小说库」开始"
                    : "选择左侧小说库进行配置"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
