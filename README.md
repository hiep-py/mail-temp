# 📧 TempMail Pro - Serverless Cloudflare Worker

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare-workers&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="License MIT">
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS">
</p>

<p align="center">
  <a href="#english">🇺🇸 English Version</a> •
  <a href="#tiếng-việt">🇻🇳 Phiên bản Tiếng Việt</a>
</p>

## 🇺🇸 English Version

TempMail Pro is a high-performance, professional disposable email solution running entirely on the Cloudflare Serverless platform. It features a modern UI, intelligent email parsing, and a robust API for developers.

### ✨ Key Features

- 🚀 **100% Serverless**: Powered by Cloudflare Workers & KV. Zero maintenance costs.
- 📬 **Smart Email Parser**: Recursively handles complex formats (Multipart, Base64, Quoted-Printable) and fixes common rendering issues (like =3D errors).
- 🎨 **Modern Dashboard**: Responsive UI built with Tailwind CSS, featuring a safe Iframe viewer for HTML emails.
- ⚙️ **Developer API**: JSON endpoints to automate account creation and message retrieval.
- 🔒 **Privacy Focused**:
  - Automatic email expiration (30 mins).
  - Secret-key based session recovery.
  - HTML sanitization to block malicious scripts.

### 🚀 Quick Start (Deployment)

#### 1. Prerequisites
- A Cloudflare account.
- A domain with Cloudflare DNS enabled.

#### 2. Setup Email Routing
- Go to Cloudflare Dashboard -> Your Domain -> Email -> Email Routing.
- Enable the service.
- Under Routing Rules, set the Catch-all address to forward to your Worker.

#### 3. KV Storage
- Go to Workers & Pages -> KV.
- Create a namespace named `EMAILS`.

#### 4. Deploying Code
- Create a new Cloudflare Worker.
- Paste the `worker.js` content into the editor.
- Update the `DOMAINS` array in the `CONFIG` constant with your domains.
- Bind the KV namespace:
  - Settings -> Variables -> KV Namespace Bindings -> Add `EMAILS`.
- Save and Deploy.

### 🔌 API Reference

| Endpoint      | Method | Description                                      |
|---------------|--------|--------------------------------------------------|
| `/api/new`    | GET    | Create a new inbox. Returns address and secret.  |
| `/api/messages` | GET  | Fetch emails. Requires address and secret params.|

### 📹 Video Tutorial

Check out this setup tutorial by Đạt Nguyễn TV: [YouTube](https://youtu.be/kR0c-4AIbkI?si=mFExnFa_frko4_Hz)

---

## 🇻🇳 Phiên bản Tiếng Việt

TempMail Pro là giải pháp email tạm thời chuyên nghiệp, hiệu suất cao chạy hoàn toàn trên nền tảng Serverless của Cloudflare. Dự án tích hợp giao diện hiện đại, bộ lọc nội dung thông minh và API mạnh mẽ.

### ✨ Tính năng nổi bật

- 🚀 **Serverless 100%**: Sử dụng Cloudflare Workers & KV. Chi phí duy trì bằng 0.
- 📬 **Bộ phân tích thông minh**: Xử lý đệ quy các định dạng phức tạp (Multipart, Base64, Quoted-Printable) và tự động sửa lỗi hiển thị nội dung (như lỗi =3D).
- 🎨 **Giao diện hiện đại**: Xây dựng bằng Tailwind CSS, hỗ trợ mobile và xem nội dung qua Iframe an toàn.
- ⚙️ **API cho lập trình viên**: Các endpoint JSON để tự động hóa việc tạo tài khoản và lấy tin nhắn.
- 🔒 **Bảo mật & Riêng tư**:
  - Tự động xóa email sau 30 phút.
  - Khôi phục phiên làm việc bằng Secret Key.
  - Khử khuẩn HTML để chặn script độc hại.

### 🚀 Hướng dẫn cài đặt nhanh

#### 1. Chuẩn bị
- Tài khoản Cloudflare.
- Tên miền đã trỏ về Cloudflare.

#### 2. Cấu hình Email Routing
- Truy cập Cloudflare Dashboard -> Tên miền của bạn -> Email -> Email Routing.
- Kích hoạt dịch vụ.
- Tại mục Routing Rules, cấu hình Catch-all address chuyển tiếp đến Worker của bạn.

#### 3. Cấu hình KV Storage
- Truy cập Workers & Pages -> KV.
- Tạo một Namespace tên là `EMAILS`.

#### 4. Triển khai mã nguồn
- Tạo một Cloudflare Worker mới.
- Dán nội dung file `worker.js` vào trình soạn thảo.
- Cập nhật mảng `DOMAINS` trong hằng số `CONFIG` bằng tên miền của bạn.
- Liên kết KV:
  - Vào Settings -> Variables -> KV Namespace Bindings -> Thêm `EMAILS`.
- Lưu và Triển khai.

### 🔌 Tài liệu API

| Endpoint      | Phương thức | Mô tả                                           |
|---------------|-------------|-------------------------------------------------|
| `/api/new`    | GET         | Tạo hộp thư mới. Trả về address và secret.     |
| `/api/messages` | GET       | Lấy danh sách email. Cần tham số address và secret. |

### 📹 Video Hướng dẫn

Xem video hướng dẫn setup này bởi Đạt Nguyễn TV: [YouTube](https://youtu.be/kR0c-4AIbkI?si=mFExnFa_frko4_Hz)

---

## 👨‍💻 Author & Credits

**Developer:** Ho Hiep  
**GitHub:** [@hiep-py](https://github.com/hiep-py)  
**License:** MIT  
**Special Thanks:** Đạt Nguyễn TV for code reference.

<p align="center">
  <i>If you find this project useful, please give it a ⭐ on GitHub!</i>  
  <br>
  <i>Nếu bạn thấy dự án này hữu ích, hãy tặng mình 1 ⭐ trên GitHub nhé!</i>
</p>