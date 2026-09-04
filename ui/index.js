/**
 * Cloudflare R2 Cloud Storage Visual File Explorer for QwenPaw.
 * Provides a split-pane layout matching QwenPaw's native Files UI:
 * - Left pane: Navigator tree, search, quick action toolbar, bucket context card
 * - Right pane: Tabbed document surface (multi-tabs, preview / edit modes, download, save to R2)
 * - Sub-tabs: All files, Documents, Code, Images, Workspace Local Sync
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
    var Button = antd.Button;
    var Tag = antd.Tag;
    var Modal = antd.Modal;
    var Input = antd.Input;
    var Space = antd.Space;
    var Popconfirm = antd.Popconfirm;
    var message = antd.message;
    var Spin = antd.Spin;
    var Empty = antd.Empty;
    var Tooltip = antd.Tooltip;

    // ── API Fetch Helper ─────────────────────────────────────────────
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
          return res.json().then(function (data) {
            throw new Error(data.detail || ("HTTP " + res.status));
          }).catch(function (err) {
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
        return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return isoStr;
      }
    }

    function getFileIcon(filename) {
      var ext = filename.split(".").pop().toLowerCase();
      if (["md", "markdown"].indexOf(ext) >= 0) return "📝";
      if (["txt", "log"].indexOf(ext) >= 0) return "📄";
      if (["py", "js", "ts", "jsx", "tsx", "json", "yaml", "yml", "toml", "sh"].indexOf(ext) >= 0) return "💻";
      if (["png", "jpg", "jpeg", "gif", "svg", "webp"].indexOf(ext) >= 0) return "🖼️";
      return "📎";
    }

    // ── Simple Rich Markdown Renderer ────────────────────────────────
    function renderSimpleMarkdown(text) {
      if (!text) return h("div", { style: { color: "#9ca3af", fontStyle: "italic" } }, "(空文件内容)");

      var lines = text.split("\n");
      var elements = [];
      var inCodeBlock = false;
      var codeBuffer = [];
      var frontmatterBuffer = [];
      var inFrontmatter = false;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        // Frontmatter detection (---)
        if (i === 0 && line.trim() === "---") {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter) {
          if (line.trim() === "---") {
            inFrontmatter = false;
            // Render frontmatter card matching QwenPaw Screenshot 3
            elements.push(
              h("div", {
                key: "frontmatter-" + i,
                style: {
                  background: "#faf8f5",
                  border: "1px solid #e8e0d8",
                  borderRadius: 12,
                  padding: "16px 20px",
                  marginBottom: 20,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "#5c554e",
                  boxShadow: "0 1px 2px rgba(56,38,25,0.03)",
                }
              }, frontmatterBuffer.map(function (fLine, fIdx) {
                var colonIdx = fLine.indexOf(":");
                if (colonIdx > 0) {
                  var k = fLine.slice(0, colonIdx).trim();
                  var v = fLine.slice(colonIdx + 1).trim();
                  return h("div", { key: fIdx, style: { display: "flex", gap: 10, marginBottom: 4 } },
                    h("span", { style: { fontWeight: 600, color: "#292522", minWidth: 80 } }, k),
                    h("span", { style: { color: "#5c554e" } }, v)
                  );
                }
                return h("div", { key: fIdx }, fLine);
              }))
            );
          } else {
            frontmatterBuffer.push(line);
          }
          continue;
        }

        // Code block
        if (line.trim().startsWith("```")) {
          if (inCodeBlock) {
            elements.push(
              h("pre", {
                key: "code-" + i,
                style: {
                  background: "#22201e",
                  color: "#f8f6f4",
                  padding: "14px 18px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontFamily: "SFMono-Regular, Consolas, Monaco, monospace",
                  overflowX: "auto",
                  lineHeight: 1.55,
                  margin: "12px 0",
                }
              }, codeBuffer.join("\n"))
            );
            codeBuffer = [];
            inCodeBlock = false;
          } else {
            inCodeBlock = true;
          }
          continue;
        }
        if (inCodeBlock) {
          codeBuffer.push(line);
          continue;
        }

        // Headings
        if (line.startsWith("# ")) {
          elements.push(
            h("h1", {
              key: "h1-" + i,
              style: {
                fontSize: 22,
                fontWeight: 700,
                color: "#292522",
                margin: "24px 0 12px",
                borderBottom: "1px solid #efe8e1",
                paddingBottom: 8,
                letterSpacing: "-0.02em",
              }
            }, line.slice(2))
          );
        } else if (line.startsWith("## ")) {
          elements.push(
            h("h2", {
              key: "h2-" + i,
              style: {
                fontSize: 17,
                fontWeight: 650,
                color: "#292522",
                margin: "20px 0 10px",
                letterSpacing: "-0.01em",
              }
            }, line.slice(3))
          );
        } else if (line.startsWith("### ")) {
          elements.push(
            h("h3", {
              key: "h3-" + i,
              style: {
                fontSize: 15,
                fontWeight: 600,
                color: "#292522",
                margin: "14px 0 6px",
              }
            }, line.slice(4))
          );
        } else if (line.startsWith("> ")) {
          // Blockquote with QwenPaw orange accent border
          elements.push(
            h("div", {
              key: "quote-" + i,
              style: {
                borderLeft: "3px solid #f36b21",
                background: "#fff9f5",
                borderRadius: "0 8px 8px 0",
                padding: "10px 16px",
                margin: "10px 0",
                color: "#5c554e",
                fontSize: 13.5,
                lineHeight: 1.6,
              }
            }, line.slice(2))
          );
        } else if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
          // List item
          elements.push(
            h("div", {
              key: "li-" + i,
              style: {
                display: "flex",
                gap: 8,
                margin: "4px 0",
                paddingLeft: line.startsWith("  ") ? 20 : 8,
                fontSize: 14,
                lineHeight: 1.65,
                color: "#292522",
              }
            },
              h("span", { style: { color: "#f36b21", fontWeight: "bold" } }, "•"),
              h("span", null, line.trim().slice(2))
            )
          );
        } else if (line.trim() === "") {
          elements.push(h("div", { key: "blank-" + i, style: { height: 10 } }));
        } else {
          elements.push(
            h("p", {
              key: "p-" + i,
              style: {
                fontSize: 14,
                lineHeight: 1.75,
                color: "#292522",
                margin: "6px 0",
              }
            }, line)
          );
        }
      }

      return h("div", { style: { maxWidth: 900, margin: "0 auto" } }, elements);
    }

    // ── Main Cloudflare R2 Explorer Component ────────────────────────
    function R2Explorer() {
      // Status state
      var stateStatus = React.useState({ configured: false, connected: false, bucket: "mypaw", account_id: "" });
      var status = stateStatus[0];
      var setStatus = stateStatus[1];

      // File list state
      var stateEntries = React.useState([]);
      var entries = stateEntries[0];
      var setEntries = stateEntries[1];

      var stateLoading = React.useState(false);
      var loading = stateLoading[0];
      var setLoading = stateLoading[1];

      // Current directory prefix
      var statePath = React.useState("");
      var currentPath = statePath[0];
      var setCurrentPath = statePath[1];

      // Search filter
      var stateSearch = React.useState("");
      var searchText = stateSearch[0];
      var setSearchText = stateSearch[1];

      // Sub-tabs (All, Docs, Code, Media, LocalSync)
      var stateSubTab = React.useState("all");
      var subTab = stateSubTab[0];
      var setSubTab = stateSubTab[1];

      // Open Document Tabs (Right pane)
      // tab item: { path, name, content, dirty, previewMode: true/false, loading: false }
      var stateTabs = React.useState([]);
      var tabs = stateTabs[0];
      var setTabs = stateTabs[1];

      var stateActiveTab = React.useState("");
      var activeTabPath = stateActiveTab[0];
      var setActiveTabPath = stateActiveTab[1];

      // Local workspace files for sync
      var stateLocalFiles = React.useState([]);
      var localFiles = stateLocalFiles[0];
      var setLocalFiles = stateLocalFiles[1];

      // Modals
      var stateUploadModal = React.useState({ visible: false, fileName: "", fileContent: "", uploading: false });
      var uploadModal = stateUploadModal[0];
      var setUploadModal = stateUploadModal[1];

      var stateConfigModal = React.useState({ visible: false, account_id: "", access_key_id: "", secret_access_key: "", bucket_name: "", saving: false });
      var configModal = stateConfigModal[0];
      var setConfigModal = stateConfigModal[1];

      // Load Status
      var refreshStatus = React.useCallback(function () {
        return apiFetch("/r2/status")
          .then(function (res) { setStatus(res); return res; })
          .catch(function (e) { console.warn("Failed to get R2 status:", e); });
      }, []);

      // Load File Entries
      var loadDirectory = React.useCallback(function (prefix) {
        setLoading(true);
        var query = prefix ? ("?path=" + encodeURIComponent(prefix)) : "";
        return apiFetch("/r2/tree" + query)
          .then(function (res) {
            setEntries(res.entries || []);
            setLoading(false);
          })
          .catch(function (err) {
            setLoading(false);
            message.error("加载 R2 文件列表失败: " + err.message);
          });
      }, []);

      // Load Local Workspace Files
      var loadLocalFiles = React.useCallback(function () {
        return apiFetch("/r2/local-files")
          .then(function (res) { setLocalFiles(res || []); })
          .catch(function () {});
      }, []);

      // Open a file into Right Pane Tabs
      var openFileTab = React.useCallback(function (fileEntry) {
        var existing = tabs.find(function (t) { return t.path === fileEntry.path; });
        if (existing) {
          setActiveTabPath(fileEntry.path);
          return;
        }

        var newTab = {
          path: fileEntry.path,
          name: fileEntry.name,
          content: "",
          dirty: false,
          previewMode: true,
          loading: true,
          size: fileEntry.size,
        };
        setTabs(function (prev) { return prev.concat([newTab]); });
        setActiveTabPath(fileEntry.path);

        apiFetch("/r2/read?path=" + encodeURIComponent(fileEntry.path))
          .then(function (res) {
            setTabs(function (prev) {
              return prev.map(function (t) {
                if (t.path === fileEntry.path) {
                  return Object.assign({}, t, { content: res.content || "", loading: false });
                }
                return t;
              });
            });
          })
          .catch(function (err) {
            message.error("读取文件失败: " + err.message);
            setTabs(function (prev) {
              return prev.map(function (t) {
                if (t.path === fileEntry.path) {
                  return Object.assign({}, t, { content: "读取失败: " + err.message, loading: false });
                }
                return t;
              });
            });
          });
      }, [tabs]);

      // Close a tab
      var closeTab = React.useCallback(function (path, e) {
        if (e) e.stopPropagation();
        var nextTabs = tabs.filter(function (t) { return t.path !== path; });
        setTabs(nextTabs);
        if (activeTabPath === path) {
          setActiveTabPath(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].path : "");
        }
      }, [tabs, activeTabPath]);

      // Save tab content back to R2
      var saveActiveTab = React.useCallback(function () {
        var activeTab = tabs.find(function (t) { return t.path === activeTabPath; });
        if (!activeTab) return;

        var hide = message.loading("正在保存到 Cloudflare R2...", 0);
        apiFetch("/r2/upload", {
          method: "POST",
          body: { path: activeTab.path, content: activeTab.content },
        }).then(function () {
          hide();
          message.success("✅ 文件已成功保存到 Cloudflare R2: " + activeTab.path);
          setTabs(function (prev) {
            return prev.map(function (t) {
              if (t.path === activeTab.path) {
                return Object.assign({}, t, { dirty: false });
              }
              return t;
            });
          });
          loadDirectory(currentPath);
        }).catch(function (err) {
          hide();
          message.error("保存失败: " + err.message);
        });
      }, [tabs, activeTabPath, currentPath, loadDirectory]);

      // Download file
      var downloadActiveFile = React.useCallback(function () {
        var activeTab = tabs.find(function (t) { return t.path === activeTabPath; });
        if (!activeTab) return;
        var blob = new Blob([activeTab.content], { type: "text/plain;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = activeTab.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, [tabs, activeTabPath]);

      // Delete file
      var deleteActiveFile = React.useCallback(function () {
        var activeTab = tabs.find(function (t) { return t.path === activeTabPath; });
        if (!activeTab) return;
        apiFetch("/r2/delete?path=" + encodeURIComponent(activeTab.path), { method: "DELETE" })
          .then(function () {
            message.success("已成功从 R2 删除文件: " + activeTab.name);
            closeTab(activeTab.path);
            loadDirectory(currentPath);
          })
          .catch(function (err) { message.error("删除失败: " + err.message); });
      }, [tabs, activeTabPath, currentPath, closeTab, loadDirectory]);

      // One-click sync local file to R2
      var syncLocalFile = React.useCallback(function (localFile) {
        var hide = message.loading("正在将 " + localFile.name + " 同步到 R2 存储空间...", 0);
        apiFetch("/r2/sync-local", {
          method: "POST",
          body: { local_path: localFile.local_path || localFile.name, r2_path: localFile.name },
        }).then(function () {
          hide();
          message.success("✅ 已成功将 " + localFile.name + " 同步到 Cloudflare R2！");
          loadDirectory(currentPath);
          setSubTab("all");
          // auto open it
          openFileTab({ path: localFile.name, name: localFile.name, size: localFile.size });
        }).catch(function (err) {
          hide();
          message.error("同步失败: " + err.message);
        });
      }, [currentPath, loadDirectory, openFileTab]);

      // Init load
      React.useEffect(function () {
        refreshStatus();
        loadDirectory("");
        loadLocalFiles();
      }, [refreshStatus, loadDirectory, loadLocalFiles]);

      // Filter entries
      var filteredEntries = entries.filter(function (e) {
        if (searchText && e.name.toLowerCase().indexOf(searchText.toLowerCase()) === -1) {
          return false;
        }
        var ext = e.name.split(".").pop().toLowerCase();
        if (subTab === "docs") return ["md", "markdown", "txt", "log"].indexOf(ext) >= 0;
        if (subTab === "code") return ["py", "js", "ts", "json", "yaml", "yml", "sh", "html"].indexOf(ext) >= 0;
        if (subTab === "media") return ["png", "jpg", "jpeg", "gif", "svg", "webp"].indexOf(ext) >= 0;
        return true;
      });

      var activeTab = tabs.find(function (t) { return t.path === activeTabPath; });

      // Save upload modal handler
      var handleSaveUpload = function () {
        if (!uploadModal.fileName.trim()) {
          message.warning("请输入文件名称");
          return;
        }
        var targetKey = currentPath ? (currentPath + "/" + uploadModal.fileName.trim()) : uploadModal.fileName.trim();
        setUploadModal(Object.assign({}, uploadModal, { uploading: true }));
        apiFetch("/r2/upload", {
          method: "POST",
          body: { path: targetKey, content: uploadModal.fileContent || "" },
        }).then(function () {
          message.success("✅ 文件已成功上传至 Cloudflare R2: " + targetKey);
          setUploadModal({ visible: false, fileName: "", fileContent: "", uploading: false });
          loadDirectory(currentPath);
          openFileTab({ path: targetKey, name: uploadModal.fileName.trim(), size: (uploadModal.fileContent || "").length });
        }).catch(function (err) {
          setUploadModal(Object.assign({}, uploadModal, { uploading: false }));
          message.error("上传失败: " + err.message);
        });
      };

      // Save config modal handler
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
        }).then(function (newStatus) {
          setConfigModal(Object.assign({}, configModal, { visible: false, saving: false }));
          setStatus(newStatus);
          message.success("✅ Cloudflare R2 凭证已保存并更新！");
          loadDirectory(currentPath);
        }).catch(function (err) {
          setConfigModal(Object.assign({}, configModal, { saving: false }));
          message.error("保存失败: " + err.message);
        });
      };

      return h("section", {
        style: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#fffdfb",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
          color: "#292522",
        }
      },
        // ── 1. Top Header Bar (Matching Files Header) ──────────────────
        h("header", {
          style: {
            minHeight: 56,
            padding: "8px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #e8e0d8",
            background: "rgba(255, 253, 251, 0.95)",
            backdropFilter: "blur(12px)",
            flexShrink: 0,
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
            h("div", {
              style: {
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                background: "#fff0e7",
                color: "#f36b21",
                fontSize: 18,
              }
            }, "☁️"),
            h("div", { style: { display: "flex", flexDirection: "column" } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                h("strong", { style: { fontSize: 14, fontWeight: 650, color: "#292522" } }, "Cloudflare R2 云端存储"),
                status.connected
                  ? h(Tag, { color: "success", style: { margin: 0, borderRadius: 10, fontSize: 11 } }, "● 已联通")
                  : h(Tag, { color: "warning", style: { margin: 0, borderRadius: 10, fontSize: 11 } }, "● 未连接"),
                h(Tag, { style: { margin: 0, borderRadius: 10, fontSize: 11, background: "#f5f3f0", border: "1px solid #e8e0d8" } }, "Bucket: " + (status.bucket || "mypaw"))
              ),
              h("span", { style: { fontSize: 11, color: "#7b746d" } }, "与工作区文件深度整合 · 支持 AI 对话直存与在线分屏查看")
            )
          ),
          h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            h(Button, {
              size: "small",
              style: { borderRadius: 8, borderColor: "#e8e0d8" },
              onClick: function () { refreshStatus(); loadDirectory(currentPath); loadLocalFiles(); }
            }, "🔄 刷新"),
            h(Button, {
              size: "small",
              style: { borderRadius: 8, borderColor: "#e8e0d8" },
              onClick: function () {
                setUploadModal({
                  visible: true,
                  fileName: "",
                  fileContent: "",
                  uploading: false,
                });
              }
            }, "⬆️ 上传文件"),
            h(Button, {
              type: "primary",
              size: "small",
              style: { borderRadius: 8, background: "#f36b21", borderColor: "#f36b21" },
              onClick: function () {
                setUploadModal({
                  visible: true,
                  fileName: "note.txt",
                  fileContent: "",
                  uploading: false,
                });
              }
            }, "➕ 新建文件"),
            h(Button, {
              size: "small",
              style: { borderRadius: 8, borderColor: "#e8e0d8" },
              onClick: function () {
                setConfigModal({
                  visible: true,
                  account_id: status.account_id || "",
                  access_key_id: "",
                  secret_access_key: "",
                  bucket_name: status.bucket || "mypaw",
                  saving: false,
                });
              }
            }, "⚙️ 存储配置")
          )
        ),

        // ── 2. Sub-Tabs Bar (Matching red arrow in Screenshot 3) ───────
        h("div", {
          style: {
            padding: "8px 16px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#faf7f3",
            borderBottom: "1px solid #e8e0d8",
            flexShrink: 0,
          }
        },
          h("div", { style: { display: "flex", gap: 6 } },
            [
              { id: "all", label: "☁️ 全部文件" },
              { id: "docs", label: "📄 文档 (md/txt)" },
              { id: "code", label: "💻 代码" },
              { id: "media", label: "🖼️ 图片" },
              { id: "local_sync", label: "🔄 同步本地工作区" },
            ].map(function (item) {
              var isActive = subTab === item.id;
              return h("button", {
                key: item.id,
                type: "button",
                onClick: function () { setSubTab(item.id); },
                style: {
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "#292522" : "#7b746d",
                  background: isActive ? "#ffffff" : "transparent",
                  border: isActive ? "1px solid #e8e0d8" : "1px solid transparent",
                  borderRadius: 7,
                  cursor: "pointer",
                  boxShadow: isActive ? "0 1px 2px rgba(56,38,25,0.04)" : "none",
                  transition: "all 120ms ease",
                }
              }, item.label);
            })
          ),
          h("div", { style: { fontSize: 11, color: "#7b746d" } },
            "R2 存储桶: " + (status.bucket || "mypaw") + " · 共 " + entries.length + " 个文件"
          )
        ),

        // ── 3. Split-Pane Layout (Left Tree + Right Tabbed Document) ────
        h("div", {
          style: {
            flex: 1,
            display: "flex",
            minHeight: 0,
            minWidth: 0,
            background: "#fffdfb",
          }
        },
          // ── LEFT PANE: Directory Navigator ─────────────────────────
          h("aside", {
            style: {
              width: 270,
              minWidth: 240,
              display: "flex",
              flexDirection: "column",
              borderRight: "1px solid #e8e0d8",
              background: "#faf7f3",
              flexShrink: 0,
            }
          },
            // Left Top Card: Bucket context (matching Screenshot 3 left card)
            h("div", { style: { padding: "10px 10px 8px" } },
              h("div", {
                style: {
                  padding: "8px 10px",
                  display: "grid",
                  gridTemplateColumns: "30px minmax(0, 1fr) 28px",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 10,
                  border: "1px solid #e5ded5",
                  background: "linear-gradient(135deg, #fff7f2, #fffdfb)",
                  boxShadow: "0 1px 2px rgba(56,38,25,0.03)",
                }
              },
                h("div", {
                  style: {
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "#fff0e7",
                    display: "grid",
                    placeItems: "center",
                    color: "#f36b21",
                    fontSize: 15,
                  }
                }, "☁️"),
                h("div", { style: { minWidth: 0 } },
                  h("div", { style: { fontSize: 12, fontWeight: 650, color: "#292522", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                    status.bucket || "mypaw"
                  ),
                  h("div", { style: { fontSize: 10.5, color: "#7b746d" } }, "Cloudflare R2 (S3)")
                ),
                h("button", {
                  type: "button",
                  title: "刷新 R2 目录",
                  onClick: function () { loadDirectory(currentPath); },
                  style: {
                    width: 28,
                    height: 28,
                    padding: 0,
                    border: "1px solid #e8e0d8",
                    borderRadius: 7,
                    background: "#fff",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                  }
                }, "🔄")
              )
            ),

            // Search filter
            h("div", { style: { padding: "0 10px 8px" } },
              h(Input, {
                size: "small",
                placeholder: "🔍 搜索 R2 文件...",
                allowClear: true,
                value: searchText,
                onChange: function (e) { setSearchText(e.target.value); },
                style: { borderRadius: 8, borderColor: "#e8e0d8" }
              })
            ),

            // Directory / File Tree List
            h("div", {
              style: {
                flex: 1,
                overflowY: "auto",
                padding: "0 6px 12px",
              }
            },
              subTab === "local_sync"
                ? // Render local workspace sync list
                  h("div", { style: { padding: "4px 6px" } },
                    h("div", { style: { fontSize: 11, fontWeight: 600, color: "#7b746d", marginBottom: 8 } }, "本地工作区文件（点击一键推送到 R2）:"),
                    localFiles.length === 0
                      ? h(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: "本地工作区暂无待同步文件" })
                      : localFiles.map(function (lf) {
                          return h("div", {
                            key: lf.name,
                            style: {
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 8px",
                              marginBottom: 4,
                              background: "#fff",
                              border: "1px solid #e8e0d8",
                              borderRadius: 8,
                            }
                          },
                            h("div", { style: { minWidth: 0, flex: 1, marginRight: 6 } },
                              h("div", { style: { fontSize: 12, fontWeight: 600, color: "#292522", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                                getFileIcon(lf.name) + " " + lf.name
                              ),
                              h("div", { style: { fontSize: 10, color: "#9ca3af" } }, formatSize(lf.size))
                            ),
                            h(Button, {
                              size: "small",
                              type: "primary",
                              style: { borderRadius: 6, fontSize: 11, background: "#f36b21", borderColor: "#f36b21", height: 24, padding: "0 6px" },
                              onClick: function () { syncLocalFile(lf); }
                            }, "⬆️ 同步")
                          );
                        })
                  )
                : // Render R2 files list
                  filteredEntries.length === 0
                    ? h("div", { style: { padding: "30px 10px", textAlign: "center", color: "#9ca3af", fontSize: 12 } },
                        loading ? h(Spin, { size: "small" }) : "暂无匹配文件"
                      )
                    : filteredEntries.map(function (entry) {
                        var isSelected = activeTabPath === entry.path;
                        return h("div", {
                          key: entry.path,
                          onClick: function () { openFileTab(entry); },
                          style: {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "7px 10px",
                            margin: "2px 0",
                            borderRadius: 8,
                            cursor: "pointer",
                            background: isSelected ? "#ffffff" : "transparent",
                            border: isSelected ? "1px solid #e8e0d8" : "1px solid transparent",
                            borderLeft: isSelected ? "3px solid #f36b21" : "3px solid transparent",
                            boxShadow: isSelected ? "0 1px 2px rgba(56,38,25,0.04)" : "none",
                            transition: "background 100ms ease",
                          },
                          onMouseEnter: function (e) {
                            if (!isSelected) e.currentTarget.style.background = "#efebe5";
                          },
                          onMouseLeave: function (e) {
                            if (!isSelected) e.currentTarget.style.background = "transparent";
                          }
                        },
                          h("div", { style: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 } },
                            h("span", { style: { fontSize: 14 } }, getFileIcon(entry.name)),
                            h("span", {
                              style: {
                                fontSize: 12.5,
                                fontWeight: isSelected ? 650 : 450,
                                color: "#292522",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }
                            }, entry.name)
                          ),
                          h("span", { style: { fontSize: 10.5, color: "#9ca3af", flexShrink: 0, marginLeft: 6 } },
                            formatSize(entry.size)
                          )
                        );
                      })
            ),

            // Left bottom status
            h("div", {
              style: {
                padding: "8px 12px",
                borderTop: "1px solid #e8e0d8",
                fontSize: 11,
                color: "#7b746d",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }
            },
              h("span", null, "共 " + filteredEntries.length + " 个文件"),
              h("span", {
                style: { cursor: "pointer", color: "#f36b21" },
                onClick: function () { loadLocalFiles(); setSubTab("local_sync"); }
              }, "🔄 工作区同步")
            )
          ),

          // ── RIGHT PANE: Document Surface (Tabs + Content) ───────────
          h("main", {
            style: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              background: "#ffffff",
              overflow: "hidden",
            }
          },
            // Multi-tab bar across the top of Right Pane
            h("div", {
              style: {
                height: 42,
                background: "#faf7f3",
                borderBottom: "1px solid #e8e0d8",
                display: "flex",
                alignItems: "stretch",
                justifyContent: "space-between",
                flexShrink: 0,
              }
            },
              // Tabs Rail
              h("div", {
                style: {
                  display: "flex",
                  alignItems: "stretch",
                  overflowX: "auto",
                  minWidth: 0,
                  flex: 1,
                }
              },
                tabs.map(function (tab) {
                  var isActive = tab.path === activeTabPath;
                  return h("div", {
                    key: tab.path,
                    onClick: function () { setActiveTabPath(tab.path); },
                    style: {
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 110,
                      maxWidth: 200,
                      padding: "0 10px 0 14px",
                      fontSize: 12,
                      fontFamily: "SFMono-Regular, Consolas, monospace",
                      color: isActive ? "#292522" : "#7b746d",
                      fontWeight: isActive ? 600 : 450,
                      background: isActive ? "#ffffff" : "transparent",
                      borderRight: "1px solid #e8e0d8",
                      cursor: "pointer",
                      userSelect: "none",
                    }
                  },
                    h("span", { style: { fontSize: 13 } }, getFileIcon(tab.name)),
                    h("span", {
                      style: {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }
                    }, tab.name),
                    tab.dirty
                      ? h("span", {
                          style: {
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#f36b21",
                            display: "inline-block",
                          }
                        })
                      : null,
                    h("span", {
                      onClick: function (e) { closeTab(tab.path, e); },
                      style: {
                        color: "#9ca3af",
                        fontSize: 14,
                        padding: "0 2px",
                        borderRadius: 4,
                      },
                      onMouseEnter: function (e) { e.currentTarget.style.color = "#f36b21"; },
                      onMouseLeave: function (e) { e.currentTarget.style.color = "#9ca3af"; }
                    }, "×"),
                    // Orange bottom underline for active tab
                    isActive
                      ? h("div", {
                          style: {
                            position: "absolute",
                            bottom: 0,
                            left: 12,
                            right: 12,
                            height: 2,
                            borderRadius: "2px 2px 0 0",
                            background: "#f36b21",
                          }
                        })
                      : null
                  );
                })
              ),

              // Right-side actions on Tab Bar (预览, 编辑, 下载, 删除)
              activeTab
                ? h("div", {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 14px",
                      flexShrink: 0,
                    }
                  },
                    // Mode Toggle: Preview vs Edit
                    h("button", {
                      type: "button",
                      onClick: function () {
                        setTabs(function (prev) {
                          return prev.map(function (t) {
                            if (t.path === activeTab.path) return Object.assign({}, t, { previewMode: true });
                            return t;
                          });
                        });
                      },
                      style: {
                        padding: "3px 9px",
                        fontSize: 11.5,
                        fontWeight: activeTab.previewMode ? 600 : 450,
                        color: activeTab.previewMode ? "#f36b21" : "#7b746d",
                        background: activeTab.previewMode ? "#fff0e7" : "transparent",
                        border: "1px solid " + (activeTab.previewMode ? "#ffcca8" : "transparent"),
                        borderRadius: 6,
                        cursor: "pointer",
                      }
                    }, "👁️ 预览"),
                    h("button", {
                      type: "button",
                      onClick: function () {
                        setTabs(function (prev) {
                          return prev.map(function (t) {
                            if (t.path === activeTab.path) return Object.assign({}, t, { previewMode: false });
                            return t;
                          });
                        });
                      },
                      style: {
                        padding: "3px 9px",
                        fontSize: 11.5,
                        fontWeight: !activeTab.previewMode ? 600 : 450,
                        color: !activeTab.previewMode ? "#f36b21" : "#7b746d",
                        background: !activeTab.previewMode ? "#fff0e7" : "transparent",
                        border: "1px solid " + (!activeTab.previewMode ? "#ffcca8" : "transparent"),
                        borderRadius: 6,
                        cursor: "pointer",
                      }
                    }, "✏️ 编辑"),

                    // Save to R2 Button (Active when in edit mode or dirty)
                    h(Button, {
                      size: "small",
                      type: (activeTab.dirty || !activeTab.previewMode) ? "primary" : "default",
                      style: {
                        borderRadius: 6,
                        fontSize: 11.5,
                        height: 26,
                        background: (activeTab.dirty || !activeTab.previewMode) ? "#f36b21" : undefined,
                        borderColor: (activeTab.dirty || !activeTab.previewMode) ? "#f36b21" : "#e8e0d8",
                      },
                      onClick: saveActiveTab,
                    }, "💾 保存到 R2"),

                    // Download Button
                    h(Button, {
                      size: "small",
                      style: { borderRadius: 6, fontSize: 11.5, height: 26, borderColor: "#e8e0d8" },
                      onClick: downloadActiveFile,
                    }, "⬇️ 下载"),

                    // Delete Button
                    h(Popconfirm, {
                      title: "确定要从 Cloudflare R2 彻底删除该文件吗？",
                      okText: "确定删除",
                      cancelText: "取消",
                      okType: "danger",
                      onConfirm: deleteActiveFile,
                    },
                      h(Button, {
                        size: "small",
                        danger: true,
                        style: { borderRadius: 6, fontSize: 11.5, height: 26 },
                      }, "🗑️ 删除")
                    )
                  )
                : null
            ),

            // Document Content Surface
            h("div", {
              style: {
                flex: 1,
                overflowY: "auto",
                padding: activeTab ? (activeTab.previewMode ? "28px 40px" : "12px 16px") : "60px 20px",
                display: "flex",
                flexDirection: "column",
              }
            },
              !activeTab
                ? // Empty State when no tab is open
                  h("div", {
                    style: {
                      margin: "auto",
                      maxWidth: 480,
                      textAlign: "center",
                      padding: "40px 20px",
                    }
                  },
                    h("div", {
                      style: {
                        width: 64,
                        height: 64,
                        borderRadius: 20,
                        background: "#fff0e7",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 32,
                        margin: "0 auto 16px",
                      }
                    }, "☁️"),
                    h("h3", { style: { fontSize: 17, fontWeight: 650, color: "#292522", marginBottom: 6 } }, "Cloudflare R2 云端存储空间"),
                    h("p", { style: { fontSize: 13, color: "#7b746d", lineHeight: 1.6, marginBottom: 20 } },
                      "从左侧文件列表中点击文件即可在右侧多标签栏中在线预览与编辑。\\n" +
                      "AI 智能体在对话中保存的文件会直接存储在此处。"
                    ),
                    h(Space, { size: "middle" },
                      h(Button, {
                        type: "primary",
                        style: { borderRadius: 8, background: "#f36b21", borderColor: "#f36b21" },
                        onClick: function () {
                          setUploadModal({ visible: true, fileName: "note.txt", fileContent: "", uploading: false });
                        }
                      }, "➕ 新建文件"),
                      h(Button, {
                        style: { borderRadius: 8, borderColor: "#e8e0d8" },
                        onClick: function () {
                          loadLocalFiles();
                          setSubTab("local_sync");
                        }
                      }, "🔄 从本地工作区同步 note.txt")
                    )
                  )
                : activeTab.loading
                  ? h("div", { style: { textAlign: "center", padding: "80px 0" } },
                      h(Spin, { size: "large", tip: "正在从 Cloudflare R2 流式加载内容..." })
                    )
                  : activeTab.previewMode
                    ? // PREVIEW MODE (Formatted Markdown matching Screenshot 3)
                      renderSimpleMarkdown(activeTab.content)
                    : // EDIT MODE (Monospace editor with Ctrl+S shortcut)
                      h("div", { style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 } },
                        h("textarea", {
                          value: activeTab.content,
                          onChange: function (e) {
                            var newContent = e.target.value;
                            setTabs(function (prev) {
                              return prev.map(function (t) {
                                if (t.path === activeTab.path) {
                                  return Object.assign({}, t, { content: newContent, dirty: true });
                                }
                                return t;
                              });
                            });
                          },
                          onKeyDown: function (e) {
                            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                              e.preventDefault();
                              saveActiveTab();
                            }
                          },
                          placeholder: "在此输入或编辑文本内容（按 Ctrl+S 快速保存至 Cloudflare R2）...",
                          style: {
                            flex: 1,
                            minHeight: 400,
                            padding: "16px 20px",
                            fontFamily: "SFMono-Regular, Consolas, Monaco, monospace",
                            fontSize: 13,
                            lineHeight: 1.65,
                            color: "#292522",
                            background: "#fffdfb",
                            border: "1px solid #e8e0d8",
                            borderRadius: 8,
                            resize: "none",
                            outline: "none",
                            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.02)",
                          }
                        }),
                        h("div", {
                          style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 10,
                            fontSize: 12,
                            color: "#7b746d",
                          }
                        },
                          h("span", null, "提示：按 Ctrl+S 快速保存到 Cloudflare R2"),
                          h(Button, {
                            type: "primary",
                            style: { borderRadius: 8, background: "#f36b21", borderColor: "#f36b21" },
                            onClick: saveActiveTab,
                          }, "💾 保存修改")
                        )
                      )
            )
          )
        ),

        // ── 4. Modals ────────────────────────────────────────────────
        // Upload / Create Modal
        h(Modal, {
          title: "⬆️ 上传 / 新建文件到 Cloudflare R2",
          open: uploadModal.visible,
          confirmLoading: uploadModal.uploading,
          okText: "保存并存入 R2",
          cancelText: "取消",
          onOk: handleSaveUpload,
          onCancel: function () { setUploadModal(Object.assign({}, uploadModal, { visible: false })); }
        },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 14, paddingTop: 10 } },
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold", fontSize: 13 } }, "文件名称（可包含目录）:"),
              h(Input, {
                placeholder: "例如: note.txt 或 docs/readme.md",
                value: uploadModal.fileName,
                onChange: function (e) { setUploadModal(Object.assign({}, uploadModal, { fileName: e.target.value })); }
              })
            ),
            h("div", null,
              h("div", { style: { marginBottom: 4, fontWeight: "bold", fontSize: 13 } }, "文件内容:"),
              h(Input.TextArea, {
                rows: 8,
                placeholder: "输入要保存到 Cloudflare R2 的文本或 Markdown 内容...",
                value: uploadModal.fileContent,
                onChange: function (e) { setUploadModal(Object.assign({}, uploadModal, { fileContent: e.target.value })); }
              })
            )
          )
        ),

        // Credentials Config Modal
        h(Modal, {
          title: "⚙️ 配置 Cloudflare R2 存储桶凭证",
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
                placeholder: "mypaw",
                value: configModal.bucket_name,
                onChange: function (e) { setConfigModal(Object.assign({}, configModal, { bucket_name: e.target.value })); }
              })
            )
          )
        )
      );
    }

    // ── Register route & Settings sidebar menu item ───────────────────
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

    // ── Also mount into Agent Workspace sidebar (primary.agentScoped) ──
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

    console.info("[cloudflare-r2] Successfully registered into QwenPaw UI matching native Files layout!");
  }

  // Start registration attempt
  tryRegister();
})();

export default true;
