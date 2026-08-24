param(
  [int]$Port = 8080
)

$root = Split-Path -Parent $PSScriptRoot

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

public class StaticServer {
    public static void Run(string root, int port) {
        var mime = new Dictionary<string, string>() {
            {".html","text/html; charset=utf-8"},
            {".htm","text/html; charset=utf-8"},
            {".css","text/css"},
            {".js","application/javascript"},
            {".json","application/json"},
            {".png","image/png"},
            {".jpg","image/jpeg"},
            {".jpeg","image/jpeg"},
            {".svg","image/svg+xml"},
            {".ico","image/x-icon"}
        };

        var listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:" + port + "/");
        listener.Start();
        Console.WriteLine("Serving " + root + " at http://localhost:" + port + "/");

        while (true) {
            HttpListenerContext ctx;
            try {
                ctx = listener.GetContext();
            } catch (HttpListenerException) {
                break;
            }
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    var req = ctx.Request;
                    var res = ctx.Response;
                    string localPath = Uri.UnescapeDataString(req.Url.LocalPath);
                    if (localPath == "/") localPath = "/index.html";
                    string filePath = Path.Combine(root, localPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

                    if (File.Exists(filePath)) {
                        string ext = Path.GetExtension(filePath).ToLowerInvariant();
                        string contentType;
                        if (!mime.TryGetValue(ext, out contentType)) contentType = "application/octet-stream";
                        byte[] bytes = File.ReadAllBytes(filePath);
                        res.ContentType = contentType;
                        res.ContentLength64 = bytes.Length;
                        res.OutputStream.Write(bytes, 0, bytes.Length);
                    } else {
                        res.StatusCode = 404;
                        byte[] bytes = Encoding.UTF8.GetBytes("404 Not Found: " + localPath);
                        res.ContentType = "text/plain; charset=utf-8";
                        res.ContentLength64 = bytes.Length;
                        res.OutputStream.Write(bytes, 0, bytes.Length);
                    }
                } catch (Exception ex) {
                    Console.WriteLine("Request error: " + ex.Message);
                } finally {
                    try { ctx.Response.OutputStream.Close(); } catch {}
                }
            });
        }
    }
}
"@

[StaticServer]::Run($root, $Port)
