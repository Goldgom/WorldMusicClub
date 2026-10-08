package org.worldmusicclub.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Only bundled resources can access the Java bridge. No sockets or shell. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://wmh.localhost";
    static { System.loadLibrary("worldmusicclub_android"); }
    private static native String nativeInitialize(String directory);
    private static native String nativeRequest(String method, String uri, String contentType, String body);
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0,
        TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(16));
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private byte[] exportBytes;

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && "wmh.localhost".equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String failure;
        try {
            // Android's /data/user/0 alias may be a link. Resolve only the OS-owned
            // files directory before Rust applies its strict descendant checks.
            File directory = new File(getFilesDir().getCanonicalFile(), "score-library");
            failure = nativeInitialize(directory.getAbsolutePath());
        } catch (java.io.IOException error) {
            failure = "Cannot resolve the private application directory: " + error.getMessage();
        }
        if (failure == null || !failure.isEmpty()) {
            android.util.Log.e("WorldMusicClub", "Library initialization failed: " + failure);
            android.widget.TextView error = new android.widget.TextView(this);
            error.setText("曲库初始化失败 / Library initialization failed\n" + failure);
            setContentView(error); return;
        }
        // Debug APKs expose WebView inspection; production flags must disable it.
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & 2) != 0);
        web = new WebView(this);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // The system picker grants only the user's selected document URIs.
        // Navigation and resource interception still reject content:// pages.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "WorldMusicClubAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (local(request.getUrl())) return false;
                // No foreign page ever enters this WebView or receives its bridge.
                if (request.isForMainFrame() && request.hasGesture()
                    && ("https".equals(request.getUrl().getScheme()) || "http".equals(request.getUrl().getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (Exception ignored) { message("无法打开链接 / Cannot open link"); }
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!local(request.getUrl()) || !"GET".equals(request.getMethod())) return blocked();
                try {
                    if ("/android-bridge.js".equals(request.getUrl().getPath()) && request.getUrl().getQuery() == null)
                        return new WebResourceResponse("text/javascript", "UTF-8", getAssets().open("android-bridge.js"));
                    JSONObject result = new JSONObject(nativeRequest("GET", request.getUrl().toString(), "", ""));
                    byte[] body = Base64.decode(result.getString("body"), Base64.DEFAULT);
                    JSONObject values = result.getJSONObject("headers");
                    HashMap<String, String> headers = new HashMap<>();
                    for (Iterator<String> keys = values.keys(); keys.hasNext();) {
                        String key = keys.next(); headers.put(key, values.getString(key));
                    }
                    String type = values.optString("content-type", "application/octet-stream").split(";")[0];
                    if ("/".equals(request.getUrl().getPath()) || "/index.html".equals(request.getUrl().getPath())) {
                        String html = new String(body, StandardCharsets.UTF_8).replace("<head>",
                            "<head><script src=\"/android-bridge.js\"></script>");
                        body = html.getBytes(StandardCharsets.UTF_8);
                        // Blob exports are read locally before the system save dialog.
                        // Keep the Android exception confined to this bundled document.
                        headers.put("content-security-policy", headers.get("content-security-policy")
                            .replace("connect-src 'self'", "connect-src 'self' blob:"));
                    }
                    int status = result.getInt("status");
                    return new WebResourceResponse(type, "UTF-8", status, status == 200 ? "OK" : "Rejected",
                        headers, new ByteArrayInputStream(body));
                } catch (Exception error) { return blocked(); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, 1); }
                catch (Exception error) { chooser.onReceiveValue(null); chooser = null; }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(ORIGIN + "/");
    }
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<String, String>(),
            new ByteArrayInputStream("Unavailable resource".getBytes(StandardCharsets.UTF_8)));
    }
    private void message(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    private void reply(String id, String envelope) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.__worldMusicClubReply(" + JSONObject.quote(id) + "," + envelope + ")", null);
        });
    }
    private static String failure(int status, String text) {
        return "{\"status\":" + status + ",\"headers\":{\"content-type\":\"application/json\"},\"body\":\""
            + Base64.encodeToString(("{\"error\":" + JSONObject.quote(text) + "}").getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP) + "\"}";
    }
    private final class Bridge {
        @JavascriptInterface public void request(String id, String method, String uri, String contentType, String body) {
            if (id == null || !id.matches("[0-9]{1,16}")) return;
            if (body == null || body.length() > 11184812) { reply(id, failure(413, "Android request exceeds 8 MiB; no source was discarded")); return; }
            try {
                workers.execute(() -> {
                    String result = nativeRequest(method, uri, contentType, body);
                    reply(id, result == null ? failure(500, "Rust response unavailable") : result);
                });
            } catch (java.util.concurrent.RejectedExecutionException error) { reply(id, failure(503, "The local engine is busy; retry shortly")); }
        }
        @JavascriptInterface public void saveFile(String name, String mime, String encoded) {
            if (encoded == null || encoded.length() > 44739244) { message("导出超过 32 MiB / Export exceeds 32 MiB"); return; }
            final byte[] data;
            try { data = Base64.decode(encoded, Base64.DEFAULT); } catch (Exception error) { message("导出编码无效 / Invalid export"); return; }
            if (data.length > 32 * 1024 * 1024) { message("导出超过 32 MiB / Export exceeds 32 MiB"); return; }
            runOnUiThread(() -> {
                if (exportBytes != null) { message("请先完成当前导出 / Complete the pending export first"); return; }
                exportBytes = data;
                String safeName = name == null ? "worldmusicclub-export" : name.replaceAll("[\\\\/\\p{Cntrl}]", "_");
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime != null && mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+") ? mime : "application/octet-stream")
                    .putExtra(Intent.EXTRA_TITLE, safeName);
                try { startActivityForResult(intent, 2); }
                catch (Exception error) { exportBytes = null; message("无法导出 / Export unavailable"); }
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1 && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); chooser = null;
        } else if (request == 2) {
            byte[] captured = exportBytes; exportBytes = null;
            if (result == RESULT_OK && data != null && data.getData() != null && captured != null) {
                Uri uri = data.getData();
                try { workers.execute(() -> {
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null) throw new java.io.IOException("No output stream");
                        stream.write(captured); message("已导出 / Export saved");
                    } catch (Exception error) { message("导出失败 / Export failed"); }
                }); } catch (java.util.concurrent.RejectedExecutionException error) { message("引擎忙，请重试导出 / Engine busy; retry export"); }
            }
        }
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (chooser != null) chooser.onReceiveValue(null);
        workers.shutdownNow(); exportBytes = null;
        if (web != null) { web.removeJavascriptInterface("WorldMusicClubAndroid"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
