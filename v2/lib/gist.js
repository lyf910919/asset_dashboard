const GIST_API = "https://api.github.com/gists";

async function requestJson(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || `GitHub API ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function buildFiles(vaultBundle, historyBundle) {
  const files = {
    "vault.json": {
      content: JSON.stringify(vaultBundle, null, 2),
    },
  };

  if (historyBundle) {
    files["history.json"] = {
      content: JSON.stringify(historyBundle, null, 2),
    };
  }

  return files;
}

export async function verifyGistToken(token) {
  if (!token) {
    throw new Error("请先填写 GitHub Token");
  }
  await requestJson(`${GIST_API}?per_page=1`, { token });
  return true;
}

export async function upsertBackupGist({ token, gistId, vaultBundle, historyBundle }) {
  if (!token) {
    throw new Error("请先填写 GitHub Token");
  }
  if (!vaultBundle) {
    throw new Error("当前没有可备份的密文数据");
  }

  const files = buildFiles(vaultBundle, historyBundle);

  if (gistId) {
    const payload = await requestJson(`${GIST_API}/${gistId}`, {
      token,
      method: "PATCH",
      body: {
        description: "QDII Vault Encrypted Backup (auto-sync)",
        files,
      },
    });
    return {
      id: payload.id,
      updatedAt: payload.updated_at,
      url: payload.html_url,
    };
  }

  const created = await requestJson(GIST_API, {
    token,
    method: "POST",
    body: {
      description: "QDII Vault Encrypted Backup (auto-sync)",
      public: false,
      files,
    },
  });

  return {
    id: created.id,
    updatedAt: created.updated_at,
    url: created.html_url,
  };
}

export async function readBackupGist({ token, gistId }) {
  if (!token) {
    throw new Error("请先填写 GitHub Token");
  }
  if (!gistId) {
    throw new Error("请先填写 Gist ID");
  }

  const payload = await requestJson(`${GIST_API}/${gistId}`, { token });
  const vaultText = payload?.files?.["vault.json"]?.content || "";
  const historyText = payload?.files?.["history.json"]?.content || "";

  return {
    id: payload?.id || gistId,
    updatedAt: payload?.updated_at || null,
    url: payload?.html_url || null,
    vaultBundle: vaultText ? JSON.parse(vaultText) : null,
    historyBundle: historyText ? JSON.parse(historyText) : null,
  };
}
