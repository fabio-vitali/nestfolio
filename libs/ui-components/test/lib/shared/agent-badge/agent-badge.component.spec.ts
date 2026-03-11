import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { AgentBadgeComponent } from '../../../../src/lib/shared/agent-badge/agent-badge.component';

@Component({
  standalone: true,
  imports: [AgentBadgeComponent],
  template: `<nf-agent-badge [agentName]="name()" [tier]="tier()" />`,
})
class TestHostComponent {
  name = signal('Portfolio Analyst');
  tier = signal('Claude Opus 4.6');
}

describe('AgentBadgeComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should display agent name', () => {
    const name = fixture.nativeElement.querySelector('.nf-agent-badge__name');
    expect(name.textContent).toBe('Portfolio Analyst');
  });

  it('should display model label', () => {
    const model = fixture.nativeElement.querySelector('.nf-agent-badge__model');
    expect(model.textContent).toBe('Claude Opus 4.6');
  });

  it('should apply opus tier class', () => {
    const badge = fixture.nativeElement.querySelector('.nf-agent-badge');
    expect(badge.classList).toContain('nf-agent-badge--opus');
  });

  it('should apply sonnet tier class', () => {
    host.tier.set('Claude Sonnet 4.6');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.nf-agent-badge');
    expect(badge.classList).toContain('nf-agent-badge--sonnet');
  });

  it('should apply haiku tier class', () => {
    host.tier.set('Claude Haiku 4.5');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.nf-agent-badge');
    expect(badge.classList).toContain('nf-agent-badge--haiku');
  });

  it('should apply deterministic tier class for non-LLM agents', () => {
    host.tier.set('deterministic');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.nf-agent-badge');
    expect(badge.classList).toContain('nf-agent-badge--deterministic');
  });

  it('should show diamond icon for opus', () => {
    const icon = fixture.nativeElement.querySelector('.nf-agent-badge__icon');
    expect(icon.textContent).toBe('\u2666');
  });

  it('should show gear icon for deterministic', () => {
    host.tier.set('deterministic');
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.nf-agent-badge__icon');
    expect(icon.textContent).toBe('\u2699');
  });
});
