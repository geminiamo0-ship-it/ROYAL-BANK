import os
import boto3
from botocore.exceptions import NoCredentialsError, ClientError

# ==========================================
# ⚠️ تنبيه: أدخل بيانات الـ Token الجديد هنا
# تأكد أن الـ Token له صلاحية (Object Read & Write)
# ==========================================
ACCESS_KEY = "أدخل_الـ_Access_Key_الجديد_هنا"
SECRET_KEY = "أدخل_الـ_Secret_Key_الجديد_هنا"
ENDPOINT_URL = "https://00f798c44eedd58e5004a9fd606dfd5f.r2.cloudflarestorage.com"
BUCKET_NAME = "أدخل_اسم_الـ_Bucket_هنا" # مثال: royal-bank-media

# مسار مجلد الصور على جهازك
MEDIA_FOLDER = r"E:\extractors\offline_media"

def upload_to_r2():
    if not os.path.exists(MEDIA_FOLDER):
        print(f"❌ المجلد غير موجود: {MEDIA_FOLDER}")
        return

    # إنشاء اتصال مع Cloudflare R2
    s3_client = boto3.client(
        's3',
        endpoint_url=ENDPOINT_URL,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name='auto' # Cloudflare R2 always uses 'auto'
    )

    print("🚀 بدء رفع الملفات إلى Cloudflare R2...")
    
    success_count = 0
    error_count = 0

    for root, dirs, files in os.walk(MEDIA_FOLDER):
        for file in files:
            local_path = os.path.join(root, file)
            # اجعل مسار الملف داخل الـ Bucket يبدأ بـ offline_media
            relative_path = os.path.relpath(local_path, MEDIA_FOLDER)
            s3_path = f"offline_media/{relative_path}".replace("\\", "/")

            try:
                # الرفع
                s3_client.upload_file(local_path, BUCKET_NAME, s3_path)
                print(f"✅ تم الرفع: {s3_path}")
                success_count += 1
            except ClientError as e:
                print(f"❌ خطأ أثناء الرفع ({s3_path}): {e}")
                error_count += 1
            except Exception as e:
                print(f"❌ خطأ غير متوقع ({s3_path}): {e}")
                error_count += 1

    print("====================================")
    print(f"🎉 اكتمل الرفع!")
    print(f"✅ نجاح: {success_count} ملف")
    if error_count > 0:
        print(f"❌ فشل: {error_count} ملف")

if __name__ == "__main__":
    upload_to_r2()
