const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl prose prose-sm dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: April 4, 2026</p>

        <h2>1. Who We Are</h2>
        <p>
          This service is operated by Ubiqisense. We provide an augmented-reality
          experience platform that lets users create, manage, and share AR
          experiences.
        </p>

        <h2>2. Data We Collect</h2>
        <ul>
          <li><strong>Account data:</strong> email address, full name, company name (optional).</li>
          <li><strong>Project data:</strong> 3D models, marker images, QR codes, and project metadata you upload or generate.</li>
          <li><strong>Usage data:</strong> basic analytics such as page views and feature usage to improve the service.</li>
        </ul>

        <h2>3. How We Use Your Data</h2>
        <ul>
          <li>To provide and maintain the AR experience platform.</li>
          <li>To authenticate your identity and protect your account.</li>
          <li>To generate and serve AR experiences you create.</li>
          <li>To improve the platform based on usage patterns.</li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>
          We do not sell your personal data. When you share an AR experience via
          a QR code or link, only the assets associated with that specific active
          experience are accessible to the recipient — no personal account data
          is exposed.
        </p>

        <h2>5. Data Storage &amp; Security</h2>
        <p>
          Your data is stored in secure, encrypted cloud infrastructure. All file
          storage buckets are private with owner-scoped access policies.
          Temporary signed URLs are used for asset delivery.
        </p>

        <h2>6. Your Rights (GDPR)</h2>
        <p>Under the General Data Protection Regulation, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> View and download all data we hold about you.</li>
          <li><strong>Rectification:</strong> Update your personal information at any time.</li>
          <li><strong>Erasure:</strong> Permanently delete your account and all associated data.</li>
          <li><strong>Portability:</strong> Export your data in a machine-readable format.</li>
        </ul>
        <p>
          You can exercise your right to erasure and data portability from the
          Settings page in your dashboard.
        </p>

        <h2>7. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active. When you
          delete your account, all personal data, projects, and uploaded files
          are permanently removed within 30 days.
        </p>

        <h2>8. Cookies</h2>
        <p>
          We use essential cookies for authentication session management. No
          third-party tracking cookies are used.
        </p>

        <h2>9. Contact</h2>
        <p>
          For privacy-related inquiries, contact us at{" "}
          <a href="mailto:privacy@ubiqisense.com" className="text-primary">
            privacy@ubiqisense.com
          </a>.
        </p>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
