/**
 * Cloudflare R2 Cloud Storage Visual File Explorer for QwenPaw.
 * Self-registers into both Settings (Plugins) and Agent Workspace (工作区).
 */
(function initR2Plugin() {
  var pluginId = "cloudflare-r2-tool";
  var attempts = 0;
  var maxAttempts = 60;

  function tryRegister() {
    attempts++;
    var QwenPaw = window.QwenPaw;
    if (!QwenPaw || !QwenPaw.host) {
      if (attempts < maxAttempts) {
        setTimeout(tryRegister, 200);
      } else {
        console.error("[cloudflare-r2] window.QwenPaw.host not found after timeout.");
      }
      return;
    }

    var host = QwenPaw.host;
    var React = host.React || window.React;
    var antd = host.antd || window.antd;

    if (!React || !antd) {
      if (attempts < maxAttempts) {
        setTimeout(tryRegister, 200);
      }
      return;
    }

    var h = React.createElement;
    var Card = antd.Card;
    var Table = antd.Table;
    var Button = antd.Button;
    var Tag = antd.Tag;
    var Modal = antd.Modal;
    var Input = antd.Input;
    var Space = antd.Space;
    var Breadcrumb = antd.Breadcrumb;
    var Popconfirm = antd.Popconfirm;
    var message = antd.message;
    var Spin = antd.Spin;
    var Empty = antd.Empty;

    function apiFetch(path, opts) {
      opts = opts || {};
      var url = host.getApiUrl ? host.getApiUrl(path) : ("/api" + path);
      var token = host.getApiToken ? host.getApiToken() : "";
      var headers = opts.headers || {};
      headers["Content-Type"] = "application/json";
      if (token) headers["Authorization"] = "Bearer " + token;
      return fetch(url, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (res) {
        if (!res.ok) {
          return res.json().then(function(data) {
            throw new Error(data.detail || ("HTTP " + res.status));
          }).catch(function(err) {
            throw new Error(err.message || ("HTTP " + res.status));
          });
        }
        return res.json();
      });
    }

    function formatSize(bytes) {
      if (bytes === null || bytes === undefined) return "-";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    function formatTime(isoStr) {
      if (!isoStr) return "-";
      try {
        var d = new Date(isoStr);
        return d.toLocaleString();
      } catch (e) {
        return isoStr;
      }
    }

    function R2Explorer() {
      var statePath = React.useState("");
      var currentPath = statePath[0];
      var setCurrentPath = statePath[1];

      var stateEntries = React.useState([]);
      var entries = stateEntries[0];
      var setEntries = stateEntries[1];

      var stateLoading = React.useState(false);
      var loading = stateLoading[0];
      var setLoading = stateLoading[1];

      var stateStatus = React.useState({ configured: false, connected: false, bucket: "", account_id: "" });
      var status = stateStatus[0];
      var setStatus = stateStatus[1];

      var statePreview = React.useState({ visible: false, title: "", content: "", loading: false });
      var previewModal = statePreview[0];
      var setPreviewModal = statePreview[1];

      var stateConfig = React.useState({
        visible: false,
        account_id: "",
        access_key_id: "",
        secret_access_key: "",
        bucket_name: "",
        saving: false,
      });
      var configModal = stateConfig[0];
      var setConfigModal = stateConfig[1];

      var stateUpload = React.useState({ visible: false, fileName: "", fileContent: "", uploading: false });
      var uploadModal = stateUpload[0];
      var setUploadModal = stateUpload[1];

      var fetchStatus = function () {
        apiFetch("/r2/status").then(function (res) {
          setStatus(res);
        }).catch(function (err) {
          console.debug("Fetch R2 status:", err);
        });
      };

      var fetchDirectory = function (path) {
        setLoading(true);
        apiFetch("/r2/tree?path=" + encodeURIComponent(path || "")).then(function (res) {
          setEntries(res.entries || []);
          setLoading(false);
        }).catch(function (err) {
          message.warning("加载文件列表失败: " + err.message);
          setEntries([]);
          setLoading(false);
        });
      };

      React.useEffect(function () {
        fetchStatus();
        fetchDirectory(currentPath);
      }, [currentPath]);

      var handleEnterDir = function (dirPath) {
        setCurrentPath(dirPath);
      };

      var handleGoBack = function () {
        if (!currentPath) return;
        var parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        setCurrentPath(parts.join("/"));
      };

      var handlePreview = function (filePath) {
        setPreviewModal({ visible: true, title: filePath, content: "", loading: true });
        apiFetch("/r2/read?path=" + encodeURIComponent(filePath)).then(function (res) {
          setPreviewModal({ visible: true, title: filePath, content: res.content || "[空内容]", loading: false });
        }).catch(function (err) {
          setPreviewModal({ visible: true, title: filePath, content: "加载失败: " + err.message, loading: false });
        });
      };

      var handleDelete = function (itemPath) {
        apiFetch("/r2/delete?path=" + encodeURIComponent(itemPath), { method: "DELETE" }).then(function () {
          message.success("删除成功: " + itemPath);
          fetchDirectory(currentPath);
        }).catch(function (err) {
          message.error("删除失败: " + err.message);
        });
      };

      var handleSaveConfig = function () {
        setConfigModal(Object.assign({}, configModal, { saving: true }));
        apiFetch("/r2/config", {
          method: "POST",
          body: {
            account_id: configModal.account_id,
            access_key_id: configModal.access_key_id,
            secret_access_key: configModal.secret_access_key,
            bucket_name: configModal.bucket_name,
          }
        }).then(function (res) {
          setStatus(res);
          setConfigModal(Object.assign({}, configModal, { visible: false, saving: false }));
          message.success("配置已保存并连接！");
          fetchDirectory(currentPath);
        }).catch(function (err) {
          setConfigModal(Object.assign({}, configModal, { saving: false }));
          message.error("保存配置失败: " + err.message);
        });
      };

      var handleSaveUpload = function () {
        if (!uploadModal.fileName) {
          message.error("请输入文件名称！");
          return;
        }
        var targetPath = (currentPath ? currentPath.replace(/\/$/, "") + "/" : "") + uploadModal.fileName.replace(/^\//, "");
        setUploadModal(Object.assign({}, uploadModal, { uploading: true }));
        apiFetch("/r2/upload", {
          method: "POST",
          body: {
            path: targetPath,
            content: uploadModal.fileContent,
          }
        }).then(function () {
          message.success("文件已成功上传至 R2: " + targetPath);
          setUploadModal({ visible: false, fileName: "", fileContent: "", uploading: false });
          fetchDirectory(currentPath);
        }).catch(function (err) {
          setUploadModal(Object.assign({}, uploadModal, { uploading: false }));
          message.error("上传失败: " + err.message);
        });
      };

      var columns = [
        {
          title: "名称",
          key: "name",
          render: function (_, item) {
            var isDir = item.kind === "directory";
            var icon = isDir ? "📁" : "📄";
            if (item.name.match(/\.(png|jpe?g|gif|webp|svg)$/i)) icon = "🖼️";
            else if (item.name.match(/\.(pdf)$/i)) icon = "📕";
            else if (item.name.match(/\.(py|js|ts|json|md|html|css)$/i)) icon = "📝";

            return h("div", {
              style: { display: "flex", alignItems: "center", gap: 8, cursor: isDir ? "pointer" : "default" },
              onClick: isDir ? function () { handleEnterDir(item.path); } : undefined,
            },
              h("span", { style: { fontSize: 18 } }, icon),
              h("span", {
                style: {
                  fontWeight: isDir ? "600" : "400",
                  color: isDir ? "#1677ff" : "inherit",
                }
              }, item.name)
            );
          }
        },
        {
          title: "类型",
          dataIndex: "kind",
          key: "kind",
          width: 120,
          render: function (k, item) {
            if (k === "directory") return h(Tag, { color: "blue" }, "目录");
            var ext = item.name.split(".").pop().toUpperCase();
            return h(Tag, null, ext || "文件");
          }
        },
        {
          title: "大小",
          dataIndex: "size",
          key: "size",
          width: 140,
          render: formatSize,
        },
        {
          title: "更新时间",
          dataIndex: "modified_at",
          key: "modified_at",
          width: 200,
          render: formatTime,
        },
        {
          title: "操作",
          key: "action",
          width: 180,
          render: function (_, item) {
            var isDir = item.kind === "directory";
            return h(Space, { size: "middle" },
              isDir
                ? h(Button, { type: "link", size: "small", onClick: function () { handleEnterDir(item.path); } }, "打开")
                : h(Button, { type: "link", size: "small", onClick: function () { handlePreview(item.path); } }, "查看内容"),
              h(Popconfirm, {
                title: "确认删除？",
                description: "确定要从 Cloudflare R2 删除 " + item.name + " 吗？",
                okText: "删除",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onConfirm: function () { handleDelete(item.path); },
              },
                h(Button, { type: "link", danger: true, size: "small" }, "删除")
              )
            );
          }
        }
      ];

      var breadcrumbItems = [
        {
          title: h("a", { onClick: function () { setCurrentPath(""); } }, "☁️ 根目录"),
        }
      ];
      if (currentPath) {
        var segments = currentPath.split("/").filter(Boolean);
        var running = "";
        segments.forEach(function (seg, idx) {
          running += (running ? "/" : "") + seg;
          var p = running;
          var isLast = idx === segments.length - 1;
          breadcrumbItems.push({
            title: isLast
              ? h("span", { style: { fontWeight: "bold" } }, seg)
              : h("a", { onClick: function () { setCurrentPath(p); } }, seg)
          });
        });
      }

      return h("div", { style: { padding: "20px 24px", height: "100%", overflowY: "auto", background: "#f8fafc" } },
        h(Card, {
          style: { marginBottom: 16, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
          bodyStyle: { padding: "16px 20px" }
        },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
              h("div", { style: { fontSize: 22, fontWeight: "bold", display: "flex", alignItems: "center", gap: 8 } },
                "☁️ Cloudflare R2 云端存储"
              ),
              status.connected
                ? h(Tag, { color: "success", style: { fontSize: 13, padding: "2px 8px" } }, "● 已联通")
                : h(Tag, { color: status.configured ? "warning" : "error", style: { fontSize: 13, padding: "2px 8px" } },
                    status.configured ? "● 连接异常" : "● 未配置凭证"),
              h(Tag, { color: "geekblue", style: { fontSize: 13, padding: "2px 8px" } },
                "Bucket: " + (status.bucket || "未指定")),
            ),
            h(Space, null,
              h(Button, {
                icon: h("span", null, "🔄"),
                onClick: function () { fetchStatus(); fetchDirectory(currentPath); }
              }, "刷新"),
              h(Button, {
                type: "primary",
                icon: h("span", null, "⬆️"),
                onClick: function () { setUploadModal({ visible: true, fileName: "", fileContent: "", uploading: false }); }
              }, "新建/上传文件"),
              h(Button, {
                icon: h("span", null, "⚙️"),
                onClick: function () {
                  setConfigModal({
                    visible: true,
                    account_id: status.account_id || "",
                    access_key_id: "",
                    secret_access_key: "",
                    bucket_name: status.bucket || "recovery-fusebox",
                    saving: false,
                  });
                }
              }, "配置凭证"),
            )
          )
        ),

        h(Card, {
          style: { marginBottom: 16, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
          bodyStyle: { padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
            currentPath
              ? h(Button, { size: "small", onClick: handleGoBack }, "⬅ 返回上一级")
              : null,
            h(Breadcrumb, { items: breadcrumbItems })
          ),
          h("div", { style: { color: "#64748b", fontSize: 13 } },
            "共 " + entries.length + " 项"
          )
        ),

        h(Card, {
          style: { borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
          bodyStyle: { padding: 0 }
        },
          h(Table, {
            columns: columns,
            dataSource: entries,
            rowKey: "path",
            loading: loading,
            pagination: { pageSize: 15, showSizeChanger: true },
            locale: { emptyText: h(Empty, { description: "当前目录暂无文件" }) }
          })
        ),

        h(Modal, {
          title: "📄 文件内容预览: " + previewModal.title,
          open: previewModal.visible,
          width: 750,
          footer: [
            h(Button, { key: "close", onClick: function () { setPreviewModal(Object.assign({}, previewModal, { visible: false })); } }, "关闭")
          ],
          onCancel: function () { setPreviewModal(Object.assign({}, previewModal, { visible: false })); }
        },
          previewModal.loading
            ? h("div", { style: { textAlign: "center", padding: "40px" } }, h(Spin, { tip: "正在从 R2 流式加载..." }))
            : h("pre", {
                style: {
                  background: "#0f172a",
                  color: "#e2e8f0",
                  padding: 16,
                  borderRadius: 8,
                  maxHeight: 480,
                  overflowY: "auto",
                  fontFamily: "Consolas, Menlo, Monaco, monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }
              }, previewModal.content)
        ),

        h(Modal, {
          title: "⬆️ 上传 / 新建文件到当前目录",
          open: uploadModal.visible,
          confirmLoading: uploadModal.uploading,
          okText: "提交上传",
          cancelText: "取消",
          onOk: handleSaveUpload,
          onCancel: function () { setUploadModal(Object.assign({}, uploadModal, { visible: false })); }
        },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 14, paddingTop: 10 } },
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "目标路径:"),
              h("div", { style: { color: "#64748b" } }, "/" + (currentPath ? currentPath + "/" : ""))
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "文件名称:"),
              h(Input, {
                placeholder: "hello.txt",
                value: uploadModal.fileName,
                onChange: function (e) { setUploadModal(Object.assign({}, uploadModal, { fileName: e.target.value })); }
              })
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "文件内容:"),
              h(Input.TextArea, {
                rows: 8,
                placeholder: "输入要写入文件的文本内容...",
                value: uploadModal.fileContent,
                onChange: function (e) { setUploadModal(Object.assign({}, uploadModal, { fileContent: e.target.value })); }
              })
            )
          )
        ),

        h(Modal, {
          title: "⚙️ 配置 Cloudflare R2 凭证",
          open: configModal.visible,
          confirmLoading: configModal.saving,
          okText: "保存配置",
          cancelText: "取消",
          onOk: handleSaveConfig,
          onCancel: function () { setConfigModal(Object.assign({}, configModal, { visible: false })); }
        },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 12, paddingTop: 10 } },
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "Account ID (Cloudflare 账户 ID):"),
              h(Input, {
                placeholder: "ac7f8382...",
                value: configModal.account_id,
                onChange: function (e) { setConfigModal(Object.assign({}, configModal, { account_id: e.target.value })); }
              })
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "Access Key ID:"),
              h(Input, {
                placeholder: "R2 Access Key ID",
                value: configModal.access_key_id,
                onChange: function (e) { setConfigModal(Object.assign({}, configModal, { access_key_id: e.target.value })); }
              })
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "Secret Access Key:"),
              h(Input.Password, {
                placeholder: "R2 Secret Access Key",
                value: configModal.secret_access_key,
                onChange: function (e) { setConfigModal(Object.assign({}, configModal, { secret_access_key: e.target.value })); }
              })
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold" } }, "Bucket Name (存储桶名称):"),
              h(Input, {
                placeholder: "recovery-fusebox",
                value: configModal.bucket_name,
                onChange: function (e) { setConfigModal(Object.assign({}, configModal, { bucket_name: e.target.value })); }
              })
            )
          )
        )
      );
    }

    // ── 1. Register route & Settings sidebar menu item ─────────────────
    if (QwenPaw.registerRoutes) {
      try {
        QwenPaw.registerRoutes(pluginId, [
          {
            path: "/cloudflare-r2",
            component: R2Explorer,
            label: "Cloudflare R2",
            icon: "☁️",
          },
        ]);
      } catch (e) {
        console.warn("[cloudflare-r2] registerRoutes:", e);
      }
    } else if (QwenPaw.route && QwenPaw.route.add) {
      try {
        QwenPaw.route.add(pluginId, {
          id: "cloudflare-r2.page",
          path: "/cloudflare-r2",
          component: R2Explorer,
        });
        if (QwenPaw.menu && QwenPaw.menu.add) {
          QwenPaw.menu.add(pluginId, {
            id: "cloudflare-r2.menu",
            location: "primary.settings",
            parentId: "plugins-group",
            label: "Cloudflare R2",
            icon: React.createElement("span", { style: { fontSize: 16 } }, "☁️"),
            route: "cloudflare-r2.page",
            order: 950,
          });
        }
      } catch (e) {
        console.warn("[cloudflare-r2] route.add fallback:", e);
      }
    }

    // ── 2. Also mount into Agent Workspace sidebar (primary.agentScoped) ──
    if (QwenPaw.menu && QwenPaw.menu.add) {
      try {
        QwenPaw.menu.add(pluginId, {
          id: "cloudflare-r2.workspace",
          location: "primary.agentScoped",
          parentId: "core.workspace-group",
          label: "R2 云端文件",
          icon: React.createElement("span", { style: { fontSize: 16 } }, "☁️"),
          route: "legacy:cloudflare-r2-tool:cloudflare-r2",
          order: 6, // directly after core.files (order: 5)
        });
      } catch (e) {
        console.warn("[cloudflare-r2] agent workspace menu.add:", e);
      }
    }

    console.info("[cloudflare-r2] Successfully registered into QwenPaw UI (Settings & Workspace)!");
  }

  // Start registration attempt
  tryRegister();
})();

export default true;
