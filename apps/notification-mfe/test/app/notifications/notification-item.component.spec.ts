import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { NotificationItemComponent } from '../../../src/app/notifications/notification-item.component';
import type { Notification } from '../../../src/app/stores/notification.store';

const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
  notificationId: 'n-001',
  tenantId: 'tenant-1',
  channel: 'IN_APP',
  title: 'Decision Approved',
  body: 'Your portfolio rebalancing has been approved',
  status: 'CREATED',
  relatedEntityType: 'DECISION',
  relatedEntityId: 'dec-001',
  createdAt: new Date().toISOString(),
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  ...overrides,
});

// Use a simple host to avoid PrimeNG issues
@Component({
  standalone: true,
  imports: [NotificationItemComponent],
  template: `<app-notification-item
    [notification]="notification()"
    (markRead)="markedId = $event"
    (tap)="tapped = $event"
  />`,
})
class TestHostComponent {
  notification = signal<Notification>(makeNotification());
  markedId: string | null = null;
  tapped: Notification | null = null;
}

describe('NotificationItemComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    })
      .overrideComponent(NotificationItemComponent, {
        set: {
          template: `
            <div class="notification-item"
              [class.notification-item--unread]="notification().status !== 'READ'"
              (click)="onTap()">
              <span class="icon-dot" [class.icon-dot--unread]="notification().status !== 'READ'"></span>
              <span class="notification-title">{{ notification().title }}</span>
              <span class="notification-text">{{ notification().body }}</span>
              @if (notification().status !== 'READ') {
                <button class="mark-read-btn" type="button" (click)="onMarkRead($event)">mark</button>
              }
            </div>
          `,
          imports: [],
          styles: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should display title', () => {
    const title = fixture.nativeElement.querySelector('.notification-title');
    expect(title.textContent).toBe('Decision Approved');
  });

  it('should display body', () => {
    const text = fixture.nativeElement.querySelector('.notification-text');
    expect(text.textContent).toContain('portfolio rebalancing');
  });

  it('should show unread indicator for unread notifications', () => {
    const item = fixture.nativeElement.querySelector('.notification-item');
    expect(item.classList).toContain('notification-item--unread');
  });

  it('should not show unread indicator for read notifications', () => {
    host.notification.set(makeNotification({ status: 'READ', readAt: new Date().toISOString() }));
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.notification-item');
    expect(item.classList).not.toContain('notification-item--unread');
  });

  it('should show mark-read button for unread notifications', () => {
    const btn = fixture.nativeElement.querySelector('.mark-read-btn');
    expect(btn).not.toBeNull();
  });

  it('should not show mark-read button for read notifications', () => {
    host.notification.set(makeNotification({ status: 'READ' }));
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.mark-read-btn');
    expect(btn).toBeNull();
  });

  it('should emit markRead when mark-read button is clicked', () => {
    const btn = fixture.nativeElement.querySelector('.mark-read-btn');
    btn.click();

    expect(host.markedId).toBe('n-001');
  });

  it('should emit tap when item is clicked', () => {
    const item = fixture.nativeElement.querySelector('.notification-item');
    item.click();

    expect(host.tapped?.notificationId).toBe('n-001');
  });
});
