using CustomsContracts;
using Microsoft.EntityFrameworkCore;

namespace LegacyCustoms;

public sealed class CustomsDbContext(DbContextOptions<CustomsDbContext> options) : DbContext(options)
{
    public DbSet<Registration> Registrations => Set<Registration>();
    public DbSet<RegistrationItem> RegistrationItems => Set<RegistrationItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Registration>(entity =>
        {
            entity.HasKey(registration => registration.Id);
            entity.HasIndex(registration => registration.CertificateNumber).IsUnique();
            entity.Property(registration => registration.Status).HasConversion<string>();
            entity.Property(registration => registration.RegistrationNumber).HasMaxLength(64);
            entity.Property(registration => registration.CertificateNumber).IsRequired();
            entity.HasMany(registration => registration.Items)
                .WithOne(item => item.Registration)
                .HasForeignKey(item => item.RegistrationId);
        });

        modelBuilder.Entity<RegistrationItem>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Quantity).HasPrecision(18, 2);
            entity.Property(item => item.FobValue).HasPrecision(18, 2);
        });
    }
}

public sealed class Registration
{
    public int Id { get; set; }
    public string CertificateNumber { get; set; } = string.Empty;
    public RegistrationStatus Status { get; set; }
    public string? RegistrationNumber { get; set; }
    public string? Reason { get; set; }
    public string ImporterId { get; set; } = string.Empty;
    public string CorrelationId { get; set; } = string.Empty;
    public DateTime ReceivedAt { get; set; }
    public List<RegistrationItem> Items { get; set; } = new();
}

public sealed class RegistrationItem
{
    public int Id { get; set; }
    public int RegistrationId { get; set; }
    public int Line { get; set; }
    public string TariffCode { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = string.Empty;
    public decimal FobValue { get; set; }
    public string OriginCriterion { get; set; } = string.Empty;
    public Registration Registration { get; set; } = null!;
}
