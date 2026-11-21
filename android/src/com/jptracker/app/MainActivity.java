package com.jptracker.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.FrameLayout;

/**
 * 一个只做一件事的壳：把本地服务（http://<电脑IP>:7788）用 WebView 全屏打开。
 * 连不上时弹出地址输入框；页面里的豆瓣 / B 站外链交给系统浏览器。
 */
public class MainActivity extends Activity {

    private static final String DEFAULT_URL = "http://192.168.0.104:7788";
    private WebView web;
    private TextView errView;
    private SharedPreferences prefs;
    private String base;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("jptracker", MODE_PRIVATE);
        base = prefs.getString("base_url", DEFAULT_URL);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 12, 17));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (android.os.Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        web.setBackgroundColor(Color.rgb(11, 12, 17));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
                    return true;
                }
                Uri target = Uri.parse(url);
                String host = target.getHost() == null ? "" : target.getHost();
                if (host.equals(Uri.parse(base).getHost())) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }

            // API 23+ 只有这个重载会被调用，旧版签名在 targetSdk >= 23 时不再触发
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req == null || !req.isForMainFrame()) {
                    return;
                }
                String desc = err == null ? "" : String.valueOf(err.getDescription());
                fail("连不上「" + base + "」\n" + desc);
            }

            @Override
            public void onReceivedError(WebView view, int code, String desc, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith("http") && !failingUrl.contains("favicon")) {
                    fail("连不上「" + base + "」\n" + desc);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideError();
            }
        });

        // 长按页面可以随时改地址（换了 Wi-Fi、电脑 IP 变了的时候）
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                showAddressDialog(null);
                return true;
            }
        });

        errView = new TextView(this);
        errView.setTextColor(Color.rgb(226, 232, 240));
        errView.setTextSize(15);
        errView.setPadding(48, 48, 48, 48);
        errView.setGravity(android.view.Gravity.CENTER);
        errView.setVisibility(View.GONE);
        errView.setBackgroundColor(Color.rgb(11, 12, 17));
        errView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideError();
                web.loadUrl(base);
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(errView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(base);
    }

    private void fail(String message) {
        if (errView == null) {
            return;
        }
        errView.setText(message + "\n\n点这里重试 · 长按页面改地址");
        errView.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errView != null && errView.getVisibility() == View.VISIBLE) {
            errView.setVisibility(View.GONE);
        }
    }

    private void showAddressDialog(String message) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("服务地址");
        String hint = "填电脑上启动窗口显示的地址，例如 " + DEFAULT_URL;
        builder.setMessage(message == null ? hint : message + "\n\n" + hint);

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(base);
        input.setSelection(input.getText().length());
        builder.setView(input);

        builder.setPositiveButton("连接", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                String value = input.getText().toString().trim();
                if (value.isEmpty()) {
                    return;
                }
                if (!value.startsWith("http://") && !value.startsWith("https://")) {
                    value = "http://" + value;
                }
                base = value;
                prefs.edit().putString("base_url", value).apply();
                web.loadUrl(value);
            }
        });
        builder.setNegativeButton("取消", null);
        builder.show();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}